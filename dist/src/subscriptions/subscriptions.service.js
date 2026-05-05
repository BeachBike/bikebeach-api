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
var SubscriptionsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const asaas_client_service_1 = require("../asaas/asaas-client.service");
const asaas_customers_service_1 = require("../asaas/asaas-customers.service");
const tenancy_1 = require("../common/tenancy");
const prisma_service_1 = require("../prisma/prisma.service");
let SubscriptionsService = SubscriptionsService_1 = class SubscriptionsService {
    prisma;
    asaas;
    customers;
    logger = new common_1.Logger(SubscriptionsService_1.name);
    constructor(prisma, asaas, customers) {
        this.prisma = prisma;
        this.asaas = asaas;
        this.customers = customers;
    }
    async create(userId, dto) {
        const plan = await this.prisma.plan.findUnique({
            where: { id: dto.planId },
        });
        if (!plan || !plan.isActive) {
            throw new common_1.BadRequestException('Plano inválido ou inativo');
        }
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException('Usuário não encontrado');
        const existingActive = await this.prisma.subscription.findFirst({
            where: { userId, status: client_1.SubscriptionStatus.ACTIVE },
        });
        if (existingActive) {
            throw new common_1.ConflictException('Você já tem uma assinatura ativa');
        }
        const customerId = await this.customers.ensureCustomer(user);
        const nextDueDate = new Date();
        nextDueDate.setDate(nextDueDate.getDate() + 1);
        const dueDateStr = nextDueDate.toISOString().slice(0, 10);
        const asaasSub = await this.asaas.createSubscription({
            customer: customerId,
            billingType: 'PIX',
            value: plan.priceCents / 100,
            nextDueDate: dueDateStr,
            cycle: 'MONTHLY',
            description: `Plano ${plan.name}`,
        });
        const now = new Date();
        const cycleEnd = new Date(now);
        cycleEnd.setMonth(cycleEnd.getMonth() + 1);
        return this.prisma.subscription.create({
            data: {
                userId,
                planId: plan.id,
                asaasSubscriptionId: asaasSub.id,
                status: client_1.SubscriptionStatus.ACTIVE,
                currentPeriodStart: now,
                currentPeriodEnd: cycleEnd,
            },
            include: { plan: true },
        });
    }
    async cancel(id, requester) {
        const sub = await this.prisma.subscription.findUnique({ where: { id } });
        if (!sub)
            throw new common_1.NotFoundException('Assinatura não encontrada');
        if (sub.userId !== requester.id && !(0, tenancy_1.isGlobalAdmin)(requester)) {
            throw new common_1.ForbiddenException('Você não pode cancelar essa assinatura');
        }
        if (sub.status === client_1.SubscriptionStatus.CANCELLED) {
            throw new common_1.BadRequestException('Assinatura já cancelada');
        }
        if (sub.asaasSubscriptionId) {
            try {
                await this.asaas.cancelSubscription(sub.asaasSubscriptionId);
            }
            catch (err) {
                this.logger.warn(`Asaas cancel for ${sub.asaasSubscriptionId} failed: ${err instanceof Error ? err.message : String(err)} — proceeding with local cancellation`);
            }
        }
        return this.prisma.subscription.update({
            where: { id },
            data: {
                status: client_1.SubscriptionStatus.CANCELLED,
                cancelledAt: new Date(),
            },
        });
    }
    async findMine(userId) {
        return this.prisma.subscription.findMany({
            where: { userId },
            include: { plan: true },
            orderBy: { createdAt: 'desc' },
        });
    }
};
exports.SubscriptionsService = SubscriptionsService;
exports.SubscriptionsService = SubscriptionsService = SubscriptionsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        asaas_client_service_1.AsaasClientService,
        asaas_customers_service_1.AsaasCustomersService])
], SubscriptionsService);
//# sourceMappingURL=subscriptions.service.js.map