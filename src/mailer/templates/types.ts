import type { EmailTemplate } from '@prisma/client';
import type { Palette } from './_shared/palette';

/// Per-template payload contracts. The mailer service is strongly typed on
/// `template` so wiring sites can't accidentally pass the wrong shape.

export interface WelcomePayload {
  name: string;
  email: string;
  appUrl: string;
}

export interface ReservationConfirmedPayload {
  name: string;
  classKind: string; // e.g. "sunset"
  instructorName: string;
  durationMinutes: number;
  intensity?: string | null; // e.g. "forte"
  startsAt: string; // ISO
  bikeLabel: string; // e.g. "B-04"
  unitName: string;
  reservationUrl: string;
  /// Cancellation cutoff (ISO) — 8h before startsAt for normal reservations,
  /// 2h for promoted-from-waitlist.
  cancelDeadlineAt: string;
  cancelDeadlineHours: 8 | 2;
}

export interface ReservationReminderPayload {
  name: string;
  classKind: string;
  instructorName: string;
  startsAt: string; // ISO
  bikeLabel: string;
  reservationUrl: string;
  /// Used by the reminder cron to dedup against EmailLog before sending.
  /// Not rendered by the template.
  reservationId: string;
}

export interface WaitlistPromotedPayload {
  name: string;
  classKind: string;
  instructorName: string;
  startsAt: string;
  bikeLabel: string;
  reservationUrl: string;
  /// Promoted reservations enjoy a 2h cancel window (instead of 8h).
  cancelDeadlineAt: string;
}

export interface ClassCancelledPayload {
  name: string;
  classKind: string;
  instructorName: string;
  startsAt: string;
  bikeLabel: string;
  /// Cancellation reason as enum string ('CHUVA', 'VENTO', 'RAIO', etc.).
  reason: string;
  reasonLabel: string; // user-friendly
  description?: string | null; // for OUTRO
  refundedCredits: number;
  rebookUrl: string;
}

export interface PasswordResetPayload {
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
  requestedFromIp?: string | null;
  userAgent?: string | null;
}

export type HealthGateKind = 'LIABILITY' | 'PARQ';

export interface HealthGateExpiringPayload {
  name: string;
  kind: HealthGateKind;
  expiresAt: string;
  renewUrl: string;
  /// Last acceptance date — shown so the user sees the cadence.
  lastAcceptedAt?: string | null;
  /// Stable key for cron dedup. `${kind}:${lastAcceptanceId-or-none}` —
  /// re-sending only happens after the user re-accepts (new id) or rolls
  /// into a new cycle. Not rendered.
  dedupKey: string;
}

export interface PaymentReceiptPayload {
  name: string;
  /// e.g. "Pacote 10 aulas".
  packLabel: string;
  amountCents: number;
  /// PIX, CREDIT_CARD, DEBIT_CARD
  method: string;
  installments?: number | null; // only for card
  paidAt: string;
  /// CreditPack total credits granted by this payment.
  credits: number;
  expiresAt: string;
  dashboardUrl: string;
}

export type TemplatePayloadMap = {
  WELCOME: WelcomePayload;
  RESERVATION_CONFIRMED: ReservationConfirmedPayload;
  RESERVATION_REMINDER: ReservationReminderPayload;
  WAITLIST_PROMOTED: WaitlistPromotedPayload;
  CLASS_CANCELLED: ClassCancelledPayload;
  PASSWORD_RESET: PasswordResetPayload;
  HEALTH_GATE_EXPIRING: HealthGateExpiringPayload;
  PAYMENT_RECEIPT: PaymentReceiptPayload;
};

export type TemplatePayload<T extends EmailTemplate> = TemplatePayloadMap[T];

export interface TemplateModule<P> {
  subject(payload: P): string;
  light(payload: P, palette: Palette): string;
  dark(payload: P, palette: Palette): string;
  text(payload: P): string;
}
