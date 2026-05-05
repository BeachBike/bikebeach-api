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
var WaitlistService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaitlistService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const tenancy_1 = require("../common/tenancy");
const health_gate_service_1 = require("../health-gate/health-gate.service");
const prisma_service_1 = require("../prisma/prisma.service");
let WaitlistService = WaitlistService_1 = class WaitlistService {
    prisma;
    healthGate;
    logger = new common_1.Logger(WaitlistService_1.name);
    constructor(prisma, healthGate) {
        this.prisma = prisma;
        this.healthGate = healthGate;
    }
    async join(slotId, user) {
        await this.healthGate.assertValid(user.id);
        const slot = await this.prisma.classSlot.findUnique({
            where: { id: slotId },
        });
        if (!slot)
            throw new common_1.NotFoundException('Aula não encontrada');
        if (slot.status !== client_1.ClassSlotStatus.SCHEDULED) {
            throw new common_1.BadRequestException('Aula não está aberta');
        }
        if (slot.startsAt.getTime() <= Date.now()) {
            throw new common_1.BadRequestException('Aula já começou ou está no passado');
        }
        const activeCount = await this.prisma.reservation.count({
            where: {
                classSlotId: slotId,
                status: {
                    in: [client_1.ReservationStatus.ACTIVE, client_1.ReservationStatus.CHECKED_IN],
                },
            },
        });
        if (activeCount < slot.capacity) {
            throw new common_1.BadRequestException('Aula ainda tem vagas — faça uma reserva direta');
        }
        const existingReservation = await this.prisma.reservation.count({
            where: {
                classSlotId: slotId,
                userId: user.id,
                status: {
                    in: [client_1.ReservationStatus.ACTIVE, client_1.ReservationStatus.CHECKED_IN],
                },
            },
        });
        if (existingReservation > 0) {
            throw new common_1.ConflictException('Você já tem uma reserva nessa aula');
        }
        try {
            return await this.prisma.waitlistEntry.create({
                data: { classSlotId: slotId, userId: user.id },
            });
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
                throw new common_1.ConflictException('Você já está na lista de espera');
            }
            throw err;
        }
    }
    async leave(slotId, user) {
        const entry = await this.prisma.waitlistEntry.findUnique({
            where: {
                classSlotId_userId: { classSlotId: slotId, userId: user.id },
            },
        });
        if (!entry) {
            throw new common_1.NotFoundException('Você não está na lista de espera');
        }
        if (entry.promotedAt) {
            throw new common_1.BadRequestException('Você já foi promovido — cancele a reserva');
        }
        await this.prisma.waitlistEntry.delete({ where: { id: entry.id } });
    }
    async clearForSlot(slotId, tx) {
        const result = await tx.waitlistEntry.updateMany({
            where: {
                classSlotId: slotId,
                promotedAt: null,
                removedAt: null,
            },
            data: { removedAt: new Date() },
        });
        return result.count;
    }
    async listFor(slotId, requester) {
        const slot = await this.prisma.classSlot.findUnique({
            where: { id: slotId },
        });
        if (!slot)
            throw new common_1.NotFoundException('Aula não encontrada');
        (0, tenancy_1.assertCanManageSlot)(requester, slot);
        return this.prisma.waitlistEntry.findMany({
            where: { classSlotId: slotId },
            orderBy: { joinedAt: 'asc' },
            include: {
                user: { select: { id: true, name: true, email: true } },
            },
        });
    }
    async tryPromoteAfterCancellation(slotId, freedBikeId) {
        return this.prisma.$transaction(async (tx) => {
            const slot = await tx.classSlot.findUnique({ where: { id: slotId } });
            if (!slot || slot.status !== client_1.ClassSlotStatus.SCHEDULED)
                return null;
            while (true) {
                const next = await tx.waitlistEntry.findFirst({
                    where: {
                        classSlotId: slotId,
                        promotedAt: null,
                        removedAt: null,
                    },
                    orderBy: { joinedAt: 'asc' },
                });
                if (!next)
                    return null;
                const candidate = await tx.user.findUnique({
                    where: { id: next.userId },
                });
                if (!candidate || !candidate.isActive) {
                    await tx.waitlistEntry.delete({ where: { id: next.id } });
                    continue;
                }
                const status = await this.healthGate.getStatus(next.userId);
                if (!status.ok) {
                    await tx.waitlistEntry.delete({ where: { id: next.id } });
                    continue;
                }
                const pack = await tx.creditPack.findFirst({
                    where: {
                        userId: next.userId,
                        remainingCredits: { gt: 0 },
                        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                    },
                    orderBy: { expiresAt: 'asc' },
                });
                if (!pack) {
                    await tx.waitlistEntry.delete({ where: { id: next.id } });
                    continue;
                }
                const decremented = await tx.creditPack.updateMany({
                    where: { id: pack.id, remainingCredits: { gt: 0 } },
                    data: { remainingCredits: { decrement: 1 } },
                });
                if (decremented.count === 0) {
                    await tx.waitlistEntry.delete({ where: { id: next.id } });
                    continue;
                }
                try {
                    const reservation = await tx.reservation.create({
                        data: {
                            classSlotId: slotId,
                            bikeId: freedBikeId,
                            userId: next.userId,
                            creditPackId: pack.id,
                            promotedFromWaitlist: true,
                            activeKey: `${slotId}:${freedBikeId}`,
                        },
                    });
                    await tx.waitlistEntry.update({
                        where: { id: next.id },
                        data: { promotedAt: new Date() },
                    });
                    return {
                        reservationId: reservation.id,
                        promotedUserId: next.userId,
                        waitlistEntryId: next.id,
                    };
                }
                catch (err) {
                    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                        err.code === 'P2002') {
                        this.logger.warn(`Promotion bike collision on slot ${slotId}, bike ${freedBikeId}`);
                        throw err;
                    }
                    throw err;
                }
            }
        });
    }
};
exports.WaitlistService = WaitlistService;
exports.WaitlistService = WaitlistService = WaitlistService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        health_gate_service_1.HealthGateService])
], WaitlistService);
//# sourceMappingURL=waitlist.service.js.map