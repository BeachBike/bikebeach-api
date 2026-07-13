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

/// Redacts LGPD-sensitive fields on the Asaas RESPONSE side. Customer
/// payloads echo back CPF/CNPJ, address, phone, mobilePhone — none of which
/// belong in a verbose debug log. Kept as a shallow scrub: the response
/// objects are flat dicts so a deep walk isn't needed.
const RESPONSE_PII_FIELDS = [
  'cpfCnpj',
  'address',
  'addressNumber',
  'complement',
  'postalCode',
  'phone',
  'mobilePhone',
  'email',
];

function redactResponsePii(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const field of RESPONSE_PII_FIELDS) {
    if (field in clone && clone[field] != null) clone[field] = '[REDACTED]';
  }
  return clone;
}

/// Thin wrapper over the Asaas v3 REST API. Pure HTTP — no business rules.
/// Tests override this provider with a Jest mock so they never hit the network.
@Injectable()
export class AsaasClientService {
  private readonly logger = new Logger(AsaasClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  /// Hard ceiling per request. Without it a hung Asaas connection would pin
  /// the payment flow forever. Configurable via `ASAAS_TIMEOUT_MS`.
  private readonly timeoutMs: number;
  /// Max attempts for IDEMPOTENT (GET) calls only. Writes are never retried
  /// — a retried POST /payments would double-charge the customer.
  private readonly maxGetAttempts = 3;

  constructor(config: ConfigService) {
    const env = config.getOrThrow<'sandbox' | 'production'>('ASAAS_ENV');
    this.baseUrl =
      env === 'production'
        ? 'https://api.asaas.com/v3'
        : 'https://api-sandbox.asaas.com/v3';
    this.apiKey = config.getOrThrow<string>('ASAAS_API_KEY');
    this.timeoutMs =
      parseInt(config.get<string>('ASAAS_TIMEOUT_MS') ?? '', 10) || 20_000;
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

  /// Entry point. GETs (idempotent) get retried on transient failures;
  /// writes never do. A retriable error is a timeout / network drop / 429 /
  /// 5xx — all surfaced as `AsaasApiError` with `status` 0 or ≥500 (so
  /// `isClientError` stays false and callers don't mistake them for a
  /// decline).
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const attempts = method === 'GET' ? this.maxGetAttempts : 1;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.doRequest<T>(method, path, body);
      } catch (err) {
        lastErr = err;
        if (attempt >= attempts || !this.isRetriable(err)) throw err;
        // Linear backoff (300ms, 600ms). Short — the caller (webhook /
        // reconcile) has its own cadence; we just want to ride out a blip.
        await this.delay(attempt * 300);
        this.logger.warn(
          `[Asaas] retry ${attempt + 1}/${attempts} for ${method} ${path}`,
        );
      }
    }
    throw lastErr;
  }

  private isRetriable(err: unknown): boolean {
    if (err instanceof AsaasApiError) {
      // 0 = timeout/network (mapped below); 429 + 5xx = transient infra.
      return err.status === 0 || err.status === 429 || err.status >= 500;
    }
    // Anything non-AsaasApiError bubbling out of doRequest is unexpected —
    // don't retry blindly.
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async doRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (body && method !== 'GET') {
      this.logger.debug(`[Asaas] Sending ${method} ${path}`, {
        body: redactCardData(body),
      });
    }

    // Bound every call by a timeout so a hung Asaas connection can't pin the
    // payment flow. Abort/network failures become AsaasApiError(status 0).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          access_token: this.apiKey,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const msg = isAbort
        ? `Asaas request timed out after ${this.timeoutMs}ms`
        : `Asaas network error: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(`[Asaas] ${method} ${path} → ${isAbort ? 'TIMEOUT' : 'NETWORK'}`);
      throw new AsaasApiError(0, msg);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`[Asaas] ${method} ${path} → ${res.status}`, {
        error: text,
        request: redactCardData(body),
      });
      throw new AsaasApiError(res.status, text);
    }

    const data = (await res.json()) as T;
    // Strip CPF/address/phone/e-mail from the debug log — Asaas echoes
    // the full customer object on /customers and /payments?include=customer
    // calls, and we don't want that PII landing in stdout / log aggregators
    // if anyone flips on DEBUG in prod.
    this.logger.debug(`[Asaas] Response ${method} ${path}`, {
      data: redactResponsePii(data),
    });
    return data;
  }
}
