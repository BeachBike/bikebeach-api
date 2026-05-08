import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AsaasCustomer,
  AsaasDeletedResponse,
  AsaasPayment,
  AsaasPixQrCode,
  AsaasSubscription,
  CreateCustomerPayload,
  CreatePaymentPayload,
  CreateSubscriptionPayload,
} from './asaas-client.types';

/// Thin wrapper over the Asaas v3 REST API. Pure HTTP — no business rules.
/// Tests override this provider with a Jest mock so they never hit the network.
@Injectable()
export class AsaasClientService {
  private readonly logger = new Logger(AsaasClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    const env = config.getOrThrow<'sandbox' | 'production'>('ASAAS_ENV');
    this.baseUrl =
      env === 'production'
        ? 'https://api.asaas.com/v3'
        : 'https://api-sandbox.asaas.com/v3';
    this.apiKey = config.getOrThrow<string>('ASAAS_API_KEY');
  }

  createCustomer(payload: CreateCustomerPayload): Promise<AsaasCustomer> {
    return this.request<AsaasCustomer>('POST', '/customers', payload);
  }

  createPayment(payload: CreatePaymentPayload): Promise<AsaasPayment> {
    return this.request<AsaasPayment>('POST', '/payments', payload);
  }

  getPayment(paymentId: string): Promise<AsaasPayment> {
    return this.request<AsaasPayment>('GET', `/payments/${paymentId}`);
  }

  getPixQrCode(paymentId: string): Promise<AsaasPixQrCode> {
    return this.request<AsaasPixQrCode>(
      'GET',
      `/payments/${paymentId}/pixQrCode`,
    );
  }

  createSubscription(
    payload: CreateSubscriptionPayload,
  ): Promise<AsaasSubscription> {
    return this.request<AsaasSubscription>('POST', '/subscriptions', payload);
  }

  cancelSubscription(id: string): Promise<AsaasDeletedResponse> {
    return this.request<AsaasDeletedResponse>('DELETE', `/subscriptions/${id}`);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (body && method !== 'GET') {
      this.logger.debug(`[Asaas] Sending ${method} ${path}`, {
        body,
      });
    }
    
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        access_token: this.apiKey,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`[Asaas] ${method} ${path} → ${res.status}`, {
        error: text,
        request: body,
      });
      throw new Error(`Asaas API error (${res.status}): ${text}`);
    }
    
    const data = (await res.json()) as T;
    this.logger.debug(`[Asaas] Response ${method} ${path}`, { data });
    return data;
  }
}
