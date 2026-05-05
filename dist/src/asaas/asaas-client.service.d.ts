import { ConfigService } from '@nestjs/config';
import type { AsaasCustomer, AsaasDeletedResponse, AsaasPayment, AsaasPixQrCode, AsaasSubscription, CreateCustomerPayload, CreatePaymentPayload, CreateSubscriptionPayload } from './asaas-client.types';
export declare class AsaasClientService {
    private readonly logger;
    private readonly baseUrl;
    private readonly apiKey;
    constructor(config: ConfigService);
    createCustomer(payload: CreateCustomerPayload): Promise<AsaasCustomer>;
    createPayment(payload: CreatePaymentPayload): Promise<AsaasPayment>;
    getPixQrCode(paymentId: string): Promise<AsaasPixQrCode>;
    createSubscription(payload: CreateSubscriptionPayload): Promise<AsaasSubscription>;
    cancelSubscription(id: string): Promise<AsaasDeletedResponse>;
    private request;
}
