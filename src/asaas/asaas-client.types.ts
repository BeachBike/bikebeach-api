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
  | 'AWAITING_RISK_ANALYSIS';

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
