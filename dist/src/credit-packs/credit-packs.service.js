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
var CreditPacksService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditPacksService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
let CreditPacksService = CreditPacksService_1 = class CreditPacksService {
    prisma;
    logger = new common_1.Logger(CreditPacksService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async grant(dto) {
        const user = await this.prisma.user.findUnique({
            where: { id: dto.userId },
        });
        if (!user)
            throw new common_1.BadRequestException('Usuário não encontrado');
        return this.prisma.creditPack.create({
            data: {
                userId: dto.userId,
                source: client_1.CreditSource.ADMIN_GRANT,
                totalCredits: dto.credits,
                remainingCredits: dto.credits,
                expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
            },
        });
    }
    async findActiveForUser(userId) {
        return this.prisma.creditPack.findMany({
            where: {
                userId,
                remainingCredits: { gt: 0 },
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            orderBy: { expiresAt: 'asc' },
        });
    }
    async findAllForUser(userId) {
        return this.prisma.creditPack.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
    }
    async expireOverduePacks() {
        const result = await this.prisma.creditPack.updateMany({
            where: {
                expiresAt: { lt: new Date() },
                remainingCredits: { gt: 0 },
            },
            data: { remainingCredits: 0 },
        });
        return result.count;
    }
    async runDailyExpiryJob() {
        const count = await this.expireOverduePacks();
        if (count > 0) {
            this.logger.log(`Expired ${count} overdue credit pack(s)`);
        }
    }
};
exports.CreditPacksService = CreditPacksService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_DAY_AT_3AM),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CreditPacksService.prototype, "runDailyExpiryJob", null);
exports.CreditPacksService = CreditPacksService = CreditPacksService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CreditPacksService);
//# sourceMappingURL=credit-packs.service.js.map