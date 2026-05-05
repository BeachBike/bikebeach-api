import { ConfigService } from '@nestjs/config';
import type { AsaasWebhookPayload } from '../asaas/asaas-client.types';
import { PaymentsService } from '../payments/payments.service';
export declare class WebhooksService {
    private readonly payments;
    private readonly logger;
    private readonly expectedToken;
    constructor(config: ConfigService, payments: PaymentsService);
    handle(receivedToken: string | undefined, payload: AsaasWebhookPayload): Promise<void>;
}
