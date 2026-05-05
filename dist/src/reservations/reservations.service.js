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
var ReservationsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReservationsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const constants_1 = require("../common/constants");
const tenancy_1 = require("../common/tenancy");
const health_gate_service_1 = require("../health-gate/health-gate.service");
const prisma_service_1 = require("../prisma/prisma.service");
const waitlist_service_1 = require("../waitlist/waitlist.service");
let ReservationsService = ReservationsService_1 = class ReservationsService {
    prisma;
    healthGate;
    waitlist;
    logger = new common_1.Logger(ReservationsService_1.name);
    constructor(prisma, healthGate, waitlist) {
        this.prisma = prisma;
        this.healthGate = healthGate;
        this.waitlist = waitlist;
    }
    async create(dto, user) {
        await this.healthGate.assertValid(user.id);
        const slot = await this.prisma.classSlot.findUnique({
            where: { id: dto.classSlotId },
        });
        if (!slot)
            throw new common_1.NotFoundException('Aula não encontrada');
        if (slot.status !== client_1.ClassSlotStatus.SCHEDULED) {
            throw new common_1.BadRequestException('Aula não está aberta para reserva');
        }
        const now = Date.now();
        if (slot.startsAt.getTime() <= now) {
            throw new common_1.BadRequestException('Aula já começou ou está no passado');
        }
        if (slot.startsAt.getTime() - now > constants_1.BOOKING_WINDOW_DAYS * 86_400_000) {
            throw new common_1.BadRequestException(`Reservas abrem ${constants_1.BOOKING_WINDOW_DAYS} dias antes da aula`);
        }
        const bike = await this.prisma.bike.findUnique({
            where: { id: dto.bikeId },
        });
        if (!bike || bike.status !== client_1.BikeStatus.OPERATIONAL) {
            throw new common_1.BadRequestException('Bike inválida ou indisponível');
        }
        if (bike.unitId !== slot.unitId) {
            throw new common_1.BadRequestException('Bike não pertence à unidade dessa aula');
        }
        const activeCount = await this.prisma.reservation.count({
            where: {
                classSlotId: slot.id,
                status: {
                    in: [client_1.ReservationStatus.ACTIVE, client_1.ReservationStatus.CHECKED_IN],
                },
            },
        });
        if (activeCount >= slot.capacity) {
            throw new common_1.ConflictException('Aula sem vagas');
        }
        const candidatePack = await this.prisma.creditPack.findFirst({
            where: {
                userId: user.id,
                remainingCredits: { gt: 0 },
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            orderBy: { expiresAt: 'asc' },
        });
        if (!candidatePack) {
            throw new common_1.BadRequestException('Sem créditos disponíveis');
        }
        try {
            return await this.prisma.$transaction(async (tx) => {
                const decremented = await tx.creditPack.updateMany({
                    where: { id: candidatePack.id, remainingCredits: { gt: 0 } },
                    data: { remainingCredits: { decrement: 1 } },
                });
                if (decremented.count === 0) {
                    throw new common_1.ConflictException('Crédito esgotado, tente novamente');
                }
                return tx.reservation.create({
                    data: {
                        classSlotId: dto.classSlotId,
                        bikeId: dto.bikeId,
                        userId: user.id,
                        creditPackId: candidatePack.id,
                        activeKey: this.activeKeyFor(dto.classSlotId, dto.bikeId),
                    },
                });
            });
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
                throw new common_1.ConflictException('Bike já reservada por outro usuário para essa aula');
            }
            throw err;
        }
    }
    async cancelByUser(reservationId, user) {
        const reservation = await this.prisma.reservation.findUnique({
            where: { id: reservationId },
            include: { classSlot: true },
        });
        if (!reservation)
            throw new common_1.NotFoundException('Reserva não encontrada');
        if (reservation.userId !== user.id && !(0, tenancy_1.isGlobalAdmin)(user)) {
            throw new common_1.ForbiddenException('Você não pode cancelar essa reserva');
        }
        if (reservation.status !== client_1.ReservationStatus.ACTIVE) {
            throw new common_1.BadRequestException('Reserva não está ativa');
        }
        if (reservation.classSlot.status !== client_1.ClassSlotStatus.SCHEDULED) {
            throw new common_1.BadRequestException('Aula já foi cancelada — sua reserva já refletirá isso');
        }
        const now = Date.now();
        const hoursToClass = (reservation.classSlot.startsAt.getTime() - now) / 3_600_000;
        const minWindow = reservation.promotedFromWaitlist
            ? constants_1.WAITLIST_PROTECTED_CANCELLATION_WINDOW_HOURS
            : constants_1.STANDARD_CANCELLATION_WINDOW_HOURS;
        const creditReturned = hoursToClass >= minWindow;
        await this.prisma.$transaction(async (tx) => {
            await tx.reservation.update({
                where: { id: reservationId },
                data: {
                    status: client_1.ReservationStatus.CANCELLED_BY_USER,
                    activeKey: null,
                    cancelledAt: new Date(),
                    cancelledByUserId: user.id,
                },
            });
            if (!creditReturned)
                return;
            const originalPack = await tx.creditPack.findUnique({
                where: { id: reservation.creditPackId },
            });
            const originalStillValid = originalPack !== null &&
                (originalPack.expiresAt === null ||
                    originalPack.expiresAt.getTime() > now);
            if (originalStillValid) {
                await tx.creditPack.update({
                    where: { id: reservation.creditPackId },
                    data: { remainingCredits: { increment: 1 } },
                });
            }
            else {
                await tx.creditPack.create({
                    data: {
                        userId: reservation.userId,
                        source: client_1.CreditSource.REFUND,
                        totalCredits: 1,
                        remainingCredits: 1,
                        expiresAt: new Date(Date.now() + constants_1.REFUND_PACK_VALIDITY_DAYS * 86_400_000),
                    },
                });
            }
        });
        let promoted = false;
        try {
            const result = await this.waitlist.tryPromoteAfterCancellation(reservation.classSlotId, reservation.bikeId);
            promoted = result !== null;
        }
        catch (err) {
            this.logger.warn(`Waitlist promotion failed for slot ${reservation.classSlotId}: ${err instanceof Error ? err.message : String(err)}`);
        }
        return {
            id: reservationId,
            status: client_1.ReservationStatus.CANCELLED_BY_USER,
            creditReturned,
            waitlistPromoted: promoted,
        };
    }
    async checkIn(reservationId, user) {
        const reservation = await this.prisma.reservation.findUnique({
            where: { id: reservationId },
            include: { classSlot: { include: { unit: true } } },
        });
        if (!reservation)
            throw new common_1.NotFoundException('Reserva não encontrada');
        if (reservation.userId !== user.id) {
            throw new common_1.ForbiddenException('Você não pode fazer check-in nessa reserva');
        }
        if (reservation.status !== client_1.ReservationStatus.ACTIVE) {
            throw new common_1.BadRequestException('Reserva não está ativa');
        }
        if (reservation.classSlot.status !== client_1.ClassSlotStatus.SCHEDULED) {
            throw new common_1.BadRequestException('Aula não está em andamento');
        }
        const now = new Date();
        const earliest = reservation.classSlot.startsAt;
        const tolerance = reservation.classSlot.unit.lateCheckinToleranceMinutes;
        const latest = new Date(earliest.getTime() + tolerance * 60_000);
        if (now < earliest) {
            throw new common_1.BadRequestException('Aula ainda não começou');
        }
        if (now > latest) {
            throw new common_1.BadRequestException(`Janela de check-in fechada (tolerância de ${tolerance} min)`);
        }
        return this.prisma.reservation.update({
            where: { id: reservationId },
            data: {
                status: client_1.ReservationStatus.CHECKED_IN,
                checkedInAt: now,
            },
        });
    }
    async bulkCancelByStudio(slotId, cancelledByUserId, tx) {
        const reservations = await tx.reservation.findMany({
            where: {
                classSlotId: slotId,
                status: {
                    in: [client_1.ReservationStatus.ACTIVE, client_1.ReservationStatus.CHECKED_IN],
                },
            },
        });
        if (reservations.length === 0)
            return { cancelled: 0, refunded: 0 };
        const now = new Date();
        let refunded = 0;
        for (const r of reservations) {
            await tx.reservation.update({
                where: { id: r.id },
                data: {
                    status: client_1.ReservationStatus.CANCELLED_BY_STUDIO,
                    activeKey: null,
                    cancelledAt: now,
                    cancelledByUserId,
                },
            });
            const pack = await tx.creditPack.findUnique({
                where: { id: r.creditPackId },
            });
            const stillValid = pack !== null &&
                (pack.expiresAt === null || pack.expiresAt.getTime() > now.getTime());
            if (stillValid) {
                await tx.creditPack.update({
                    where: { id: r.creditPackId },
                    data: { remainingCredits: { increment: 1 } },
                });
            }
            else {
                await tx.creditPack.create({
                    data: {
                        userId: r.userId,
                        source: client_1.CreditSource.REFUND,
                        totalCredits: 1,
                        remainingCredits: 1,
                        expiresAt: new Date(now.getTime() + constants_1.REFUND_PACK_VALIDITY_DAYS * 86_400_000),
                    },
                });
            }
            refunded++;
        }
        return { cancelled: reservations.length, refunded };
    }
    async findMine(user) {
        return this.prisma.reservation.findMany({
            where: { userId: user.id },
            include: {
                classSlot: {
                    include: {
                        classKind: true,
                        instructor: { select: { id: true, name: true } },
                    },
                },
                bike: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOne(id, user) {
        const reservation = await this.prisma.reservation.findUnique({
            where: { id },
            include: {
                classSlot: {
                    include: {
                        classKind: true,
                        instructor: { select: { id: true, name: true } },
                    },
                },
                bike: true,
            },
        });
        if (!reservation)
            throw new common_1.NotFoundException('Reserva não encontrada');
        if (reservation.userId !== user.id && !(0, tenancy_1.isGlobalAdmin)(user)) {
            throw new common_1.ForbiddenException();
        }
        return reservation;
    }
    activeKeyFor(classSlotId, bikeId) {
        return `${classSlotId}:${bikeId}`;
    }
};
exports.ReservationsService = ReservationsService;
exports.ReservationsService = ReservationsService = ReservationsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        health_gate_service_1.HealthGateService,
        waitlist_service_1.WaitlistService])
], ReservationsService);
//# sourceMappingURL=reservations.service.js.map