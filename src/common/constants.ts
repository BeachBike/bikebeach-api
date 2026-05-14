/// Days until a `LiabilityAcceptance` row stops being valid for the gate.
/// Per CLAUDE.md product rules: monthly re-acceptance.
export const LIABILITY_VALIDITY_DAYS = 30;

/// Days until a `ParqResponse` row stops being valid. Quarterly re-acceptance.
export const PARQ_VALIDITY_DAYS = 90;

/// Furthest in advance a user can book a class.
export const BOOKING_WINDOW_DAYS = 7;

/// Minimum lead time (minutes) before class start. Reservations attempted
/// inside this window are rejected — the studio needs a quiet pre-class
/// stretch for setup, and bikes that go live at T-9min would feel chaotic.
export const MIN_RESERVATION_LEAD_MINUTES = 10;

/// Standard cancellation cutoff: cancel earlier than this (in hours before
/// class start) and the credit is refunded. Cancel later and credit is lost.
export const STANDARD_CANCELLATION_WINDOW_HOURS = 8;

/// Reservations promoted from waitlist get a more lenient window because the
/// promotion may have happened too late for the standard window to be fair.
export const WAITLIST_PROTECTED_CANCELLATION_WINDOW_HOURS = 2;

/// Default expiry applied to a `REFUND` CreditPack that we create when the
/// original pack has already expired by the time of cancellation.
export const REFUND_PACK_VALIDITY_DAYS = 30;

/// TTL for password-reset tokens issued via /auth/forgot-password.
export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;

/// PIX discount applied to one-off pack purchases. Whole-percent value
/// (5 = 5% off). 2026-05 — promoted from `Unit.pixDiscountPercent` to a
/// system-wide constant since the studio decided every arena uses the
/// same deal.
export const PIX_DISCOUNT_PERCENT = 5;

/// Credit-card installment policy (Brazilian market standard).
/// `CARD_INSTALLMENT_FREE_LIMIT` = max installments that the merchant
/// absorbs (sem juros). Any installmentCount above this gets interest
/// passed to the customer at `CARD_MONTHLY_INTEREST` (compound monthly).
/// The financed total is `cash * (1 + rate)^N` and Asaas divides it
/// across N installments. 2026-05-14 — switched from Asaas dashboard
/// config to in-process calc so the math is auditable + deterministic
/// in tests, and so the FE can show the exact financed total per option.
export const CARD_INSTALLMENT_FREE_LIMIT = 3;
export const CARD_MONTHLY_INTEREST = 0.0299;

/// Returns the financed total (in cents) the customer pays for a card
/// charge of `cashCents` paid in `installments` parcelas. Sem juros up to
/// `CARD_INSTALLMENT_FREE_LIMIT`; compound monthly above that. Rounded to
/// whole cents so the value matches the eventual receipt.
export function computeFinancedTotalCents(
  cashCents: number,
  installments: number,
): number {
  if (installments <= CARD_INSTALLMENT_FREE_LIMIT) return cashCents;
  // Only apply interest for installments AFTER the free limit (4+).
  // For 4x: 1 month of interest; for 5x: 2 months; for 6x: 3 months.
  const monthsWithInterest = installments - CARD_INSTALLMENT_FREE_LIMIT;
  const factor = Math.pow(1 + CARD_MONTHLY_INTEREST, monthsWithInterest);
  return Math.round(cashCents * factor);
}
