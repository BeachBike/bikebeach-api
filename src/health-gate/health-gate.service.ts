import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LIABILITY_VALIDITY_DAYS,
  PARQ_VALIDITY_DAYS,
} from '../common/constants';
import {
  isParqFlagged,
  parqFlaggedKeys,
  parqNotes,
} from '../common/parq-questions';
import { PrismaService } from '../prisma/prisma.service';

interface AcceptanceContext {
  ipAddress?: string;
  userAgent?: string;
}

interface GateField {
  version: string | null;
  acceptedAt: Date | null;
  expiresAt: Date | null;
  valid: boolean;
}

interface ParqField extends GateField {
  /// Last submitted answer object — frontend uses this to pre-fill the form
  /// so the user only edits what changed (per CLAUDE.md product rule).
  latestAnswers: Record<string, unknown> | null;
  /// True when the latest PAR-Q has any risk-flagged answer (active health
  /// concern). Drives the "estou ciente" warning before reserving and the
  /// health badge on the instructor/admin roster.
  flagged: boolean;
  /// Which question keys are flagged — lets the UI point at them.
  flaggedKeys: string[];
}

export interface HealthGateStatus {
  liability: GateField;
  parq: ParqField;
  ok: boolean;
}

/// Full health snapshot for a manager (instructor of the class / admin) to
/// review a participant. Read-only; never exposed to peers.
export interface ManagerHealthView {
  parq: {
    version: string | null;
    acceptedAt: Date | null;
    expiresAt: Date | null;
    valid: boolean;
    flagged: boolean;
    flaggedKeys: string[];
    answers: Record<string, unknown> | null;
    notes: string | null;
  };
  liability: {
    version: string | null;
    acceptedAt: Date | null;
    expiresAt: Date | null;
    valid: boolean;
  };
}

@Injectable()
export class HealthGateService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(userId: string): Promise<HealthGateStatus> {
    const [latestLiability, latestParq] = await Promise.all([
      this.prisma.liabilityAcceptance.findFirst({
        where: { userId },
        orderBy: { acceptedAt: 'desc' },
      }),
      this.prisma.parqResponse.findFirst({
        where: { userId },
        orderBy: { acceptedAt: 'desc' },
      }),
    ]);

    const now = Date.now();
    const liability = this.computeField(
      latestLiability?.version ?? null,
      latestLiability?.acceptedAt ?? null,
      LIABILITY_VALIDITY_DAYS,
      now,
    );
    const parqBase = this.computeField(
      latestParq?.version ?? null,
      latestParq?.acceptedAt ?? null,
      PARQ_VALIDITY_DAYS,
      now,
    );
    const latestAnswers =
      (latestParq?.answers as Record<string, unknown> | null) ?? null;
    const parq: ParqField = {
      ...parqBase,
      latestAnswers,
      flagged: isParqFlagged(latestAnswers),
      flaggedKeys: parqFlaggedKeys(latestAnswers),
    };

    return { liability, parq, ok: liability.valid && parq.valid };
  }

  /// Full PAR-Q + liability for a manager (instructor of the participant's
  /// class, or admin) to review. Callers MUST authorize access first
  /// (e.g. `assertCanManageSlot` + the user actually being in that slot).
  async getUserHealthForManager(userId: string): Promise<ManagerHealthView> {
    const [latestLiability, latestParq] = await Promise.all([
      this.prisma.liabilityAcceptance.findFirst({
        where: { userId },
        orderBy: { acceptedAt: 'desc' },
      }),
      this.prisma.parqResponse.findFirst({
        where: { userId },
        orderBy: { acceptedAt: 'desc' },
      }),
    ]);

    const now = Date.now();
    const liability = this.computeField(
      latestLiability?.version ?? null,
      latestLiability?.acceptedAt ?? null,
      LIABILITY_VALIDITY_DAYS,
      now,
    );
    const parqBase = this.computeField(
      latestParq?.version ?? null,
      latestParq?.acceptedAt ?? null,
      PARQ_VALIDITY_DAYS,
      now,
    );
    const answers =
      (latestParq?.answers as Record<string, unknown> | null) ?? null;

    return {
      parq: {
        ...parqBase,
        flagged: isParqFlagged(answers),
        flaggedKeys: parqFlaggedKeys(answers),
        answers,
        notes: parqNotes(answers),
      },
      liability,
    };
  }

  /// Throws 403 with structured details if either gate is invalid.
  async assertValid(userId: string): Promise<void> {
    const status = await this.getStatus(userId);
    if (!status.ok) {
      throw new ForbiddenException({
        message: 'Termo de responsabilidade ou PAR-Q vencidos/ausentes',
        code: 'HEALTH_GATE_BLOCK',
        details: status,
      });
    }
  }

  async acceptLiability(
    userId: string,
    version: string,
    ctx: AcceptanceContext,
  ) {
    return this.prisma.liabilityAcceptance.create({
      data: {
        userId,
        version,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  }

  async submitParq(
    userId: string,
    version: string,
    answers: Record<string, unknown>,
    ctx: AcceptanceContext,
  ) {
    return this.prisma.parqResponse.create({
      data: {
        userId,
        version,
        answers: answers as Prisma.InputJsonValue,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  }

  private computeField(
    version: string | null,
    acceptedAt: Date | null,
    validityDays: number,
    nowMs: number,
  ): GateField {
    if (!acceptedAt) {
      return { version: null, acceptedAt: null, expiresAt: null, valid: false };
    }
    const expiresAt = new Date(
      acceptedAt.getTime() + validityDays * 86_400_000,
    );
    return {
      version,
      acceptedAt,
      expiresAt,
      valid: expiresAt.getTime() > nowMs,
    };
  }
}
