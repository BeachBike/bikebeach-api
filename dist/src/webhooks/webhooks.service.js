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
var WebhooksService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhooksService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const payments_service_1 = require("../payments/payments.service");
let WebhooksService = WebhooksService_1 = class WebhooksService {
    payments;
    logger = new common_1.Logger(WebhooksService_1.name);
    expectedToken;
    constructor(config, payments) {
        this.payments = payments;
        this.expectedToken = config.getOrThrow('ASAAS_WEBHOOK_TOKEN');
    }
    async handle(receivedToken, payload) {
        if (!receivedToken || receivedToken !== this.expectedToken) {
            throw new common_1.UnauthorizedException('Invalid webhook authentication');
        }
        switch (payload.event) {
            case 'PAYMENT_CREATED':
                if (payload.payment?.subscription) {
                    await this.payments.upsertSubscriptionCyclePayment(payload.payment);
                }
                break;
            case 'PAYMENT_CONFIRMED':
            case 'PAYMENT_RECEIVED':
                if (payload.payment) {
                    await this.payments.applyPaymentConfirmation(payload.payment);
                }
                break;
            default:
                this.logger.log(`Ignored Asaas event: ${payload.event}`);
        }
    }
};
exports.WebhooksService = WebhooksService;
exports.WebhooksService = WebhooksService = WebhooksService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        payments_service_1.PaymentsService])
], WebhooksService);
//# sourceMappingURL=webhooks.service.js.map