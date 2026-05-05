import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import type { AsaasWebhookPayload } from '../asaas/asaas-client.types';
import { Public } from '../common/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';

@Controller('asaas')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /// Asaas → us. Authenticated by the shared `asaas-access-token` header
  /// (mirrors the value set in the Asaas dashboard webhook config).
  /// Always returns 200 quickly so Asaas doesn't retry on slow processing.
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Headers('asaas-access-token') token: string | undefined,
    @Body() body: AsaasWebhookPayload,
  ): Promise<{ received: true }> {
    await this.webhooks.handle(token, body);
    return { received: true };
  }
}
