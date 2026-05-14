/// Minimal subset of the Asaas v3 REST shapes we touch in this codebase.
/// Extend as we wire more endpoints in 5e-2 and beyond.

export interface AsaasCustomer {
  id: string;
  name: string;
  email: string;
  cpfCnpj?: string;
  mobilePhone?: string;
}

export interface CreateCustomerPayload {
  name: string;
  email: string;
  cpfCnpj: string;
  mobilePhone?: string;
}

export type AsaasBillingType = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO';

export type AsaasPaymentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'RECEIVED'
  | 'OVERDUE'
  | 'REFUNDED'
  /// Card charge accepted but held for manual fraud review.
  | 'AWAITING_RISK_ANALYSIS'
  /// Card charge rejected by Asaas anti-fraud after review.
  | 'REPROVED_BY_RISK_ANALYSIS'
  /// Refund / chargeback lifecycle — surfaced via webhook events; we keep
  /// the union complete so the reconciliation sync can narrow safely.
  | 'REFUND_REQUESTED'
  | 'REFUND_IN_PROGRESS'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL';

/// Card metadata Asaas echoes back on a CREDIT_CARD / DEBIT_CARD payment.
/// `creditCardNumber` is the last 4 digits only — never the full PAN.
export interface AsaasCreditCardInfo {
  creditCardNumber?: string;
  creditCardBrand?: string;
  creditCardToken?: string;
}

export interface AsaasPayment {
  id: string;
  customer: string;
  billingType: AsaasBillingType;
  status: AsaasPaymentStatus;
  /// BRL as a float (e.g. 199.0 for R$ 199,00). Asaas does NOT use cents.
  value: number;
  netValue?: number;
  externalReference?: string | null;
  dueDate?: string;
  /// Set by Asaas when this Payment is part of a Subscription cycle.
  subscription?: string | null;
  /// Set on card payments — number of parcelas.
  installmentCount?: number | null;
  /// Set on card payments once processed. `creditCardNumber` = last 4.
  creditCard?: AsaasCreditCardInfo | null;
}

export type AsaasSubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'INACTIVE';

export type AsaasCycle =
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMIANNUALLY'
  | 'YEARLY';

export interface AsaasSubscription {
  id: string;
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  nextDueDate: string;
  cycle: AsaasCycle;
  status: AsaasSubscriptionStatus;
  description?: string | null;
}

export interface CreateSubscriptionPayload {
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  /// `YYYY-MM-DD` — when Asaas should bill the first cycle.
  nextDueDate: string;
  cycle: AsaasCycle;
  description?: string;
}

export interface AsaasDeletedResponse {
  deleted: boolean;
  id: string;
}

export interface CreatePaymentPayload {
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  /// `YYYY-MM-DD`.
  dueDate: string;
  description?: string;
  externalReference?: string;
}

/// Raw card data — exists only transiently in memory between the controller
/// and the Asaas HTTP call. NEVER persisted, NEVER logged (the client
/// redacts it). `ccv` is the CVV; Asaas does not return it and we never
/// store it.
export interface AsaasCreditCard {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

/// Cardholder identification — required by Asaas anti-fraud on every
/// transparent card charge.
export interface AsaasCreditCardHolderInfo {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  addressComplement?: string | null;
  phone: string;
  mobilePhone?: string;
}

/// Transparent card charge (credit or debit).
/// - À vista (`installmentCount` 1 / omitted): send `value` = the amount
///   the customer pays (already includes any interest we computed locally
///   — see `computeFinancedTotalCents`).
/// - Parcelado (`installmentCount` > 1, CREDIT only): send `totalValue` =
///   financed total and `installmentCount`; Asaas just splits it. We do
///   NOT rely on the Asaas dashboard "parcelamento com juros" config —
///   the interest math lives in our service so it's deterministic +
///   auditable + visible in the UI before submit.
/// `remoteIp` is the END USER's IP, required by Asaas anti-fraud — capture it
/// from the request, not the server.
export interface CreateCardPaymentPayload {
  customer: string;
  billingType: 'CREDIT_CARD' | 'DEBIT_CARD';
  value?: number;
  totalValue?: number;
  installmentCount?: number;
  /// `YYYY-MM-DD`.
  dueDate: string;
  description?: string;
  externalReference?: string;
  creditCard: AsaasCreditCard;
  creditCardHolderInfo: AsaasCreditCardHolderInfo;
  remoteIp: string;
}

export interface AsaasPixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

/// Inbound webhook payload. Asaas sends both `event` and the relevant entity.
/// We type the union loosely and let consumers narrow on `event`.
export interface AsaasWebhookPayload {
  event: string;
  payment?: AsaasPayment;
  // Future: subscription, transfer, etc.
}
