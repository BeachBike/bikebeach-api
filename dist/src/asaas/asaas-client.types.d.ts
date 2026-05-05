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
export type AsaasPaymentStatus = 'PENDING' | 'CONFIRMED' | 'RECEIVED' | 'OVERDUE' | 'REFUNDED' | 'AWAITING_RISK_ANALYSIS';
export interface AsaasPayment {
    id: string;
    customer: string;
    billingType: AsaasBillingType;
    status: AsaasPaymentStatus;
    value: number;
    netValue?: number;
    externalReference?: string | null;
    dueDate?: string;
    subscription?: string | null;
}
export type AsaasSubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'INACTIVE';
export type AsaasCycle = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';
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
    dueDate: string;
    description?: string;
    externalReference?: string;
}
export interface AsaasPixQrCode {
    encodedImage: string;
    payload: string;
    expirationDate: string;
}
export interface AsaasWebhookPayload {
    event: string;
    payment?: AsaasPayment;
}
