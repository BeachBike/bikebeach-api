import type { EmailTemplate } from '@prisma/client';
import { classCancelledTemplate } from './class-cancelled';
import { healthGateExpiringTemplate } from './health-gate-expiring';
import { passwordResetTemplate } from './password-reset';
import { paymentReceiptTemplate } from './payment-receipt';
import { reservationConfirmedTemplate } from './reservation-confirmed';
import { reservationReminderTemplate } from './reservation-reminder';
import type { TemplateModule, TemplatePayload, TemplatePayloadMap } from './types';
import { waitlistPromotedTemplate } from './waitlist-promoted';
import { welcomeTemplate } from './welcome';

export const TEMPLATES: {
  [K in keyof TemplatePayloadMap]: TemplateModule<TemplatePayloadMap[K]>;
} = {
  WELCOME: welcomeTemplate,
  RESERVATION_CONFIRMED: reservationConfirmedTemplate,
  RESERVATION_REMINDER: reservationReminderTemplate,
  WAITLIST_PROMOTED: waitlistPromotedTemplate,
  CLASS_CANCELLED: classCancelledTemplate,
  PASSWORD_RESET: passwordResetTemplate,
  HEALTH_GATE_EXPIRING: healthGateExpiringTemplate,
  PAYMENT_RECEIPT: paymentReceiptTemplate,
};

export type { TemplatePayload };

export function getTemplate<T extends EmailTemplate>(t: T): TemplateModule<TemplatePayload<T>> {
  return TEMPLATES[t] as TemplateModule<TemplatePayload<T>>;
}
