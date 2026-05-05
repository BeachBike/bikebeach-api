"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AsaasClientService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsaasClientService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let AsaasClientService = AsaasClientService_1 = class AsaasClientService {
    logger = new common_1.Logger(AsaasClientService_1.name);
    baseUrl;
    apiKey;
    constructor(config) {
        const env = config.getOrThrow('ASAAS_ENV');
        this.baseUrl =
            env === 'production'
                ? 'https://api.asaas.com/v3'
                : 'https://api-sandbox.asaas.com/v3';
        this.apiKey = config.getOrThrow('ASAAS_API_KEY');
    }
    createCustomer(payload) {
        return this.request('POST', '/customers', payload);
    }
    createPayment(payload) {
        return this.request('POST', '/payments', payload);
    }
    getPixQrCode(paymentId) {
        return this.request('GET', `/payments/${paymentId}/pixQrCode`);
    }
    createSubscription(payload) {
        return this.request('POST', '/subscriptions', payload);
    }
    cancelSubscription(id) {
        return this.request('DELETE', `/subscriptions/${id}`);
    }
    async request(method, path, body) {
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
            this.logger.error(`Asaas ${method} ${path} → ${res.status}: ${text}`);
            throw new Error(`Asaas API error (${res.status}): ${text}`);
        }
        return (await res.json());
    }
};
exports.AsaasClientService = AsaasClientService;
exports.AsaasClientService = AsaasClientService = AsaasClientService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AsaasClientService);
//# sourceMappingURL=asaas-client.service.js.map