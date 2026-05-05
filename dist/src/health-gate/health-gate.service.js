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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthGateService = void 0;
const common_1 = require("@nestjs/common");
const constants_1 = require("../common/constants");
const prisma_service_1 = require("../prisma/prisma.service");
let HealthGateService = class HealthGateService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getStatus(userId) {
        const [latestLiability, latestParq] = await Promise.all([
            this.prisma.liabilityAcceptance.findFirst({
                where: { userId },
                orderBy: { acceptedAt: 'desc' },
            }),
            this.prisma.parqResponse.findFirst({
                where: { userId },
                orderBy: { acceptedAt: 'desc' },
            }),
        ]);
        const now = Date.now();
        const liability = this.computeField(latestLiability?.version ?? null, latestLiability?.acceptedAt ?? null, constants_1.LIABILITY_VALIDITY_DAYS, now);
        const parq = this.computeField(latestParq?.version ?? null, latestParq?.acceptedAt ?? null, constants_1.PARQ_VALIDITY_DAYS, now);
        return { liability, parq, ok: liability.valid && parq.valid };
    }
    async assertValid(userId) {
        const status = await this.getStatus(userId);
        if (!status.ok) {
            throw new common_1.ForbiddenException({
                message: 'Termo de responsabilidade ou PAR-Q vencidos/ausentes',
                code: 'HEALTH_GATE_BLOCK',
                details: status,
            });
        }
    }
    async acceptLiability(userId, version, ctx) {
        return this.prisma.liabilityAcceptance.create({
            data: {
                userId,
                version,
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
            },
        });
    }
    async submitParq(userId, version, answers, ctx) {
        return this.prisma.parqResponse.create({
            data: {
                userId,
                version,
                answers: answers,
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
            },
        });
    }
    computeField(version, acceptedAt, validityDays, nowMs) {
        if (!acceptedAt) {
            return { version: null, acceptedAt: null, expiresAt: null, valid: false };
        }
        const expiresAt = new Date(acceptedAt.getTime() + validityDays * 86_400_000);
        return {
            version,
            acceptedAt,
            expiresAt,
            valid: expiresAt.getTime() > nowMs,
        };
    }
};
exports.HealthGateService = HealthGateService;
exports.HealthGateService = HealthGateService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], HealthGateService);
//# sourceMappingURL=health-gate.service.js.map