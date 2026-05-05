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
var PaymentsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const asaas_client_service_1 = require("../asaas/asaas-client.service");
const asaas_customers_service_1 = require("../asaas/asaas-customers.service");
const prisma_service_1 = require("../prisma/prisma.service");
let PaymentsService = PaymentsService_1 = class PaymentsService {
    prisma;
    asaas;
    customers;
    logger = new common_1.Logger(PaymentsService_1.name);
    constructor(prisma, asaas, customers) {
        this.prisma = prisma;
        this.asaas = asaas;
        this.customers = customers;
    }
    async createPixPackCharge(userId, packOfferId) {
        const offer = await this.prisma.packOffer.findUnique({
            where: { id: packOfferId },
            include: { unit: true },
        });
        if (!offer || !offer.isActive) {
            throw new common_1.BadRequestException({
                code: 'INVALID_PACK_OFFER',
                message: 'Pacote inválido ou desativado',
            });
        }
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException('Usuário não encontrado');
        const customerId = await this.customers.ensureCustomer(user);
        const basePriceCents = offer.priceCents;
        const pixDiscountPercent = offer.unit.pixDiscountPercent;
        const discountCents = Math.round((basePriceCents * pixDiscountPercent) / 100);
        const amountCents = basePriceCents - discountCents;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 1);
        const dueDateStr = dueDate.toISOString().slice(0, 10);
        const charge = await this.asaas.createPayment({
            customer: customerId,
            billingType: 'PIX',
            value: amountCents / 100,
            dueDate: dueDateStr,
            description: pixDiscountPercent > 0
                ? `Pacote ${offer.classes} aula${offer.classes > 1 ? 's' : ''} (PIX -${pixDiscountPercent}%)`
                : `Pacote ${offer.classes} aula${offer.classes > 1 ? 's' : ''}`,
        });
        const payment = await this.prisma.payment.create({
            data: {
                userId: user.id,
                asaasChargeId: charge.id,
                amountCents,
                method: client_1.PaymentMethod.PIX,
                status: client_1.PaymentStatus.PENDING,
                kind: client_1.PaymentKind.ONE_OFF_PACK,
                packCredits: offer.classes,
                packExpirationDays: offer.expirationDays,
            },
        });
        const qr = await this.asaas.getPixQrCode(charge.id);
        return {
            paymentId: payment.id,
            asaasChargeId: charge.id,
            amountCents,
            basePriceCents,
            pixDiscountPercent,
            pix: {
                qrCodeImage: qr.encodedImage,
                qrCodePayload: qr.payload,
                expiresAt: qr.expirationDate,
            },
        };
    }
    async applyPaymentConfirmation(asaasPayment) {
        const local = await this.prisma.payment.findUnique({
            where: { asaasChargeId: asaasPayment.id },
        });
        if (!local) {
            this.logger.warn(`Webhook for unknown asaasChargeId=${asaasPayment.id}; ignoring`);
            return;
        }
        if (local.status === client_1.PaymentStatus.PAID)
            return;
        await this.prisma.$transaction(async (tx) => {
            await tx.payment.update({
                where: { id: local.id },
                data: { status: client_1.PaymentStatus.PAID, paidAt: new Date() },
            });
            if (local.kind === client_1.PaymentKind.ONE_OFF_PACK &&
                local.packCredits !== null &&
                local.packCredits > 0) {
                const validityDays = local.packExpirationDays ?? 30;
                await tx.creditPack.create({
                    data: {
                        userId: local.userId,
                        source: client_1.CreditSource.PURCHASE_PACK,
                        totalCredits: local.packCredits,
                        remainingCredits: local.packCredits,
                        paymentId: local.id,
                        expiresAt: new Date(Date.now() + validityDays * 86_400_000),
                    },
                });
            }
            else if (local.kind === client_1.PaymentKind.SUBSCRIPTION_CYCLE &&
                local.subscriptionId) {
                const sub = await tx.subscription.findUnique({
                    where: { id: local.subscriptionId },
                    include: { plan: true },
                });
                if (!sub) {
                    this.logger.warn(`Subscription ${local.subscriptionId} vanished mid-tx`);
                    return;
                }
                await tx.creditPack.create({
                    data: {
                        userId: local.userId,
                        source: client_1.CreditSource.SUBSCRIPTION_CYCLE,
                        totalCredits: sub.plan.monthlyCredits,
                        remainingCredits: sub.plan.monthlyCredits,
                        subscriptionId: sub.id,
                        paymentId: local.id,
                        expiresAt: sub.currentPeriodEnd,
                    },
                });
                const nextStart = sub.currentPeriodEnd;
                const nextEnd = new Date(nextStart);
                nextEnd.setMonth(nextEnd.getMonth() + 1);
                await tx.subscription.update({
                    where: { id: sub.id },
                    data: {
                        currentPeriodStart: nextStart,
                        currentPeriodEnd: nextEnd,
                    },
                });
            }
        });
    }
    async upsertSubscriptionCyclePayment(asaasPayment) {
        if (!asaasPayment.subscription)
            return;
        const sub = await this.prisma.subscription.findUnique({
            where: { asaasSubscriptionId: asaasPayment.subscription },
        });
        if (!sub) {
            this.logger.warn(`Webhook PAYMENT_CREATED for unknown asaasSubscriptionId=${asaasPayment.subscription}; ignoring`);
            return;
        }
        const amountCents = Math.round(asaasPayment.value * 100);
        const billing = asaasPayment.billingType;
        const method = billing === 'CREDIT_CARD'
            ? client_1.PaymentMethod.CREDIT_CARD
            : billing === 'DEBIT_CARD'
                ? client_1.PaymentMethod.DEBIT_CARD
                : client_1.PaymentMethod.PIX;
        await this.prisma.payment.upsert({
            where: { asaasChargeId: asaasPayment.id },
            create: {
                userId: sub.userId,
                asaasChargeId: asaasPayment.id,
                amountCents,
                method,
                status: client_1.PaymentStatus.PENDING,
                kind: client_1.PaymentKind.SUBSCRIPTION_CYCLE,
                subscriptionId: sub.id,
            },
            update: {},
        });
    }
    async findMine(userId) {
        return this.prisma.payment.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
    }
};
exports.PaymentsService = PaymentsService;
exports.PaymentsService = PaymentsService = PaymentsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        asaas_client_service_1.AsaasClientService,
        asaas_customers_service_1.AsaasCustomersService])
], PaymentsService);
//# sourceMappingURL=payments.service.js.map