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
