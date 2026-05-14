import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AsaasCustomer,
  AsaasDeletedResponse,
  AsaasPayment,
  AsaasPixQrCode,
  AsaasSubscription,
  CreateCardPaymentPayload,
  CreateCustomerPayload,
  CreatePaymentPayload,
  CreateSubscriptionPayload,
} from './asaas-client.types';

/// Asaas list endpoints wrap results in this envelope.
interface AsaasList<T> {
  data: T[];
  totalCount: number;
  hasMore: boolean;
}

/// One entry of the Asaas `{ errors: [...] }` error body.
export interface AsaasError {
  code?: string;
  description?: string;
}

/// Thrown by `AsaasClientService.request()` on any non-2xx response. Carries
/// the HTTP status + parsed `errors` so callers (e.g. the card charge flow)
/// can tell a card decline (4xx, surfaceable to the user) from an
/// infrastructure failure (5xx / network) without re-parsing strings.
export class AsaasApiError extends Error {
  readonly status: number;
  readonly errors: AsaasError[];

  constructor(status: number, rawBody: string) {
    let errors: AsaasError[] = [];
    try {
      const parsed = JSON.parse(rawBody) as { errors?: AsaasError[] };
      if (Array.isArray(parsed.errors)) errors = parsed.errors;
    } catch {
      // non-JSON body — leave errors empty, message still carries the text
    }
    const summary =
      errors.map((e) => e.description).filter(Boolean).join(' · ') || rawBody;
    super(`Asaas API error (${status}): ${summary}`);
    this.name = 'AsaasApiError';
    this.status = status;
    this.errors = errors;
  }

  /// 4xx (except 429) = the request itself was rejected — for a card charge
  /// that means a decline / invalid data the user can act on. 5xx / 429 =
  /// transient infra failure that should NOT be shown as "card declined".
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

/// Deep-redacts card data before anything reaches a log sink. The raw PAN
/// and CVV must NEVER appear in logs, error trackers, or anywhere else —
/// this is the single choke point that guarantees it.
function redactCardData(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  if ('creditCard' in clone) clone.creditCard = '[REDACTED]';
  if ('creditCardHolderInfo' in clone) clone.creditCardHolderInfo = '[REDACTED]';
  return clone;
}

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

  /// Transparent card charge. The `payload` carries raw card data — the
  /// `request()` logger redacts it so the PAN/CVV never hit a log sink.
  createCardPayment(payload: CreateCardPaymentPayload): Promise<AsaasPayment> {
    return this.request<AsaasPayment>('POST', '/payments', payload);
  }

  getPayment(paymentId: string): Promise<AsaasPayment> {
    return this.request<AsaasPayment>('GET', `/payments/${paymentId}`);
  }

  /// Looks a charge up by our `externalReference` (the local Payment id).
  /// Used to reconcile after a network timeout — lets us check whether a
  /// charge actually went through before the user retries (avoids a double
  /// charge). Returns the first match or null.
  async getPaymentByExternalReference(
    externalReference: string,
  ): Promise<AsaasPayment | null> {
    const list = await this.request<AsaasList<AsaasPayment>>(
      'GET',
      `/payments?externalReference=${encodeURIComponent(externalReference)}`,
    );
    return list.data[0] ?? null;
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
        body: redactCardData(body),
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
        request: redactCardData(body),
      });
      throw new AsaasApiError(res.status, text);
    }
    
    const data = (await res.json()) as T;
    this.logger.debug(`[Asaas] Response ${method} ${path}`, { data });
    return data;
  }
}
