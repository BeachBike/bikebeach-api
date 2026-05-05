import type { AsaasWebhookPayload } from '../asaas/asaas-client.types';
import { WebhooksService } from './webhooks.service';
export declare class WebhooksController {
    private readonly webhooks;
    constructor(webhooks: WebhooksService);
    handle(token: string | undefined, body: AsaasWebhookPayload): Promise<{
        received: true;
    }>;
}
