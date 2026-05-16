import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailStatus,
  EmailTemplate,
  EmailVariant,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResendClient } from './resend.client';
import { getTemplate } from './templates';
import { DARK, LIGHT } from './templates/_shared/palette';
import type { TemplatePayload } from './templates/types';

/// Fields that must NEVER be persisted to `EmailLog.payload` because they
/// would let anyone with DB read access take an authenticated action. Right
/// now the only one is the password-reset URL, which carries the
/// single-use raw token that the user is about to receive via e-mail. The
/// renderer still gets the real value — redaction happens only on the
/// audit-log copy.
const PAYLOAD_REDACTION: Partial<Record<EmailTemplate, readonly string[]>> = {
  PASSWORD_RESET: ['resetUrl'],
};

function redactForLog<T extends EmailTemplate>(
  template: T,
  payload: TemplatePayload<T>,
): TemplatePayload<T> {
  const secretFields = PAYLOAD_REDACTION[template];
  if (!secretFields || secretFields.length === 0) return payload;
  const source = payload as unknown as Record<string, unknown>;
  const clone: Record<string, unknown> = { ...source };
  for (const field of secretFields) {
    if (field in clone) clone[field] = '[REDACTED]';
  }
  return clone as unknown as TemplatePayload<T>;
}

export interface SendArgs<T extends EmailTemplate> {
  template: T;
  to: string;
  payload: TemplatePayload<T>;
  userId?: string | null;
  /// Override the random pick. Mainly used in tests so renders are stable.
  variant?: EmailVariant;
}

/// Central e-mail dispatcher. Each call:
///   1. picks LIGHT or DARK at random (50/50) unless overridden
///   2. renders subject + html + text via the template module
///   3. inserts an `EmailLog` row with status=QUEUED
///   4. fires the Resend HTTP call (no API key = SKIPPED + console log)
///   5. updates the same `EmailLog` row to SENT/FAILED/SKIPPED
///
/// `send()` returns the EmailLog id once the row is persisted so callers
/// can await audit, but does NOT block on the Resend HTTP request — the
/// dispatch runs after the row is created (so reservation flows never wait
/// on an outbound HTTP call).
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resend: ResendClient,
    private readonly config: ConfigService,
  ) {}

  async send<T extends EmailTemplate>(args: SendArgs<T>): Promise<string> {
    const variant: EmailVariant =
      args.variant ?? (Math.random() < 0.5 ? EmailVariant.LIGHT : EmailVariant.DARK);
    const palette = variant === EmailVariant.LIGHT ? LIGHT : DARK;
    const tpl = getTemplate(args.template);

    const subject = tpl.subject(args.payload);
    const html =
      variant === EmailVariant.LIGHT
        ? tpl.light(args.payload, palette)
        : tpl.dark(args.payload, palette);
    const text = tpl.text(args.payload);

    const log = await this.prisma.emailLog.create({
      data: {
        template: args.template,
        variant,
        status: EmailStatus.QUEUED,
        toEmail: args.to,
        subject,
        userId: args.userId ?? null,
        // Secrets like the password-reset URL must NEVER reach the audit
        // table — anyone with DB read access could reuse them within the
        // token TTL. `redactForLog` swaps known sensitive fields with the
        // sentinel before persistence; the renderer above still ran with
        // the real values.
        payload: redactForLog(args.template, args.payload) as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // Dispatch without awaiting so callers don't pay the HTTP latency.
    void this.dispatch(log.id, args.to, subject, html, text);
    return log.id;
  }

  private async dispatch(
    logId: string,
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<void> {
    if (!this.resend.isConfigured()) {
      this.logger.log(
        `[stub] e-mail "${subject}" → ${to} (RESEND_API_KEY unset; preview ${html.length}B html, ${text.length}B text)`,
      );
      await this.prisma.emailLog
        .update({
          where: { id: logId },
          data: { status: EmailStatus.SKIPPED, sentAt: new Date() },
        })
        .catch((err) =>
          this.logger.warn(`failed to mark EmailLog ${logId} as SKIPPED: ${(err as Error).message}`),
        );
      return;
    }

    try {
      const result = await this.resend.send({
        from: this.config.get<string>('EMAIL_FROM') ?? 'bikebeach <ola@bikebeach.com.br>',
        to,
        subject,
        html,
        text,
      });
      await this.prisma.emailLog.update({
        where: { id: logId },
        data: {
          status: EmailStatus.SENT,
          externalId: result.id,
          sentAt: new Date(),
        },
      });
      this.logger.log(`sent ${logId} → ${to} (resend ${result.id})`);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`mailer dispatch failed for ${logId} → ${to}: ${message}`);
      await this.prisma.emailLog
        .update({
          where: { id: logId },
          data: { status: EmailStatus.FAILED, errorMessage: message.slice(0, 800) },
        })
        .catch((logErr) =>
          this.logger.warn(`failed to mark EmailLog ${logId} as FAILED: ${(logErr as Error).message}`),
        );
    }
  }
}
