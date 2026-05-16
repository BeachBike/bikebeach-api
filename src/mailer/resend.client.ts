import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ResendSendArgs {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /// `Reply-To` header (optional).
  replyTo?: string;
}

export interface ResendSendResult {
  /// Resend message id. Used as `EmailLog.externalId`.
  id: string;
}

/// Thin wrapper around Resend's REST API. We use plain `fetch` so we don't
/// have to pull in the SDK — one HTTP POST is all we need. When
/// RESEND_API_KEY is unset the client throws `ResendNotConfiguredError` and
/// the mailer service falls back to the dev stub.
export class ResendNotConfiguredError extends Error {
  constructor() {
    super('RESEND_API_KEY is not set');
  }
}

@Injectable()
export class ResendClient {
  private readonly logger = new Logger(ResendClient.name);
  private readonly apiKey?: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('RESEND_API_KEY');
  }

  isConfigured(): boolean {
    // Tests must be hermetic — never hit the Resend API even if a real key
    // is present in the developer's `.env`. Under NODE_ENV=test the mailer
    // falls back to the stub path and records the send as SKIPPED.
    if (process.env.NODE_ENV === 'test') return false;
    return !!this.apiKey && this.apiKey.length > 0;
  }

  async send(args: ResendSendArgs): Promise<ResendSendResult> {
    if (!this.isConfigured()) throw new ResendNotConfiguredError();

    const body: Record<string, unknown> = {
      from: args.from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    };
    if (args.replyTo) body.reply_to = args.replyTo;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`Resend ${res.status}: ${text}`);
    }

    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error('Resend response missing id');
    return { id: json.id };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}
