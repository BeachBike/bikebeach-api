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
exports.ClassSlotsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const tenancy_1 = require("../common/tenancy");
const prisma_service_1 = require("../prisma/prisma.service");
const reservations_service_1 = require("../reservations/reservations.service");
const waitlist_service_1 = require("../waitlist/waitlist.service");
let ClassSlotsService = class ClassSlotsService {
    prisma;
    reservations;
    waitlist;
    constructor(prisma, reservations, waitlist) {
        this.prisma = prisma;
        this.reservations = reservations;
        this.waitlist = waitlist;
    }
    async create(dto, user) {
        (0, tenancy_1.assertCanAccessUnit)(user, dto.unitId);
        if (user.role === client_1.Role.INSTRUCTOR && dto.instructorId !== user.id) {
            throw new common_1.ForbiddenException('Instrutor só pode agendar as próprias aulas');
        }
        const unit = await this.prisma.unit.findUnique({
            where: { id: dto.unitId },
        });
        if (!unit || !unit.isActive) {
            throw new common_1.BadRequestException('Unidade inválida ou inativa');
        }
        const instructor = await this.prisma.user.findUnique({
            where: { id: dto.instructorId },
        });
        if (!instructor ||
            instructor.role !== client_1.Role.INSTRUCTOR ||
            instructor.unitId !== dto.unitId ||
            !instructor.isActive) {
            throw new common_1.BadRequestException('Instrutor inválido para essa unidade');
        }
        let durationMinutes = dto.durationMinutes;
        if (dto.classKindId) {
            const kind = await this.prisma.classKind.findUnique({
                where: { id: dto.classKindId },
            });
            if (!kind || !kind.isActive) {
                throw new common_1.BadRequestException('Tipo de aula inválido ou inativo');
            }
            durationMinutes ??= kind.defaultDurationMinutes;
        }
        if (!durationMinutes) {
            throw new common_1.BadRequestException('Informe durationMinutes ou um classKindId válido');
        }
        const startsAt = new Date(dto.startsAt);
        if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
            throw new common_1.BadRequestException('A aula precisa começar no futuro');
        }
        return this.prisma.classSlot.create({
            data: {
                unitId: dto.unitId,
                instructorId: dto.instructorId,
                classKindId: dto.classKindId,
                title: dto.title,
                startsAt,
                durationMinutes,
                capacity: dto.capacity,
            },
        });
    }
    async list(filter) {
        const startsAtFilter = {};
        if (filter.from)
            startsAtFilter.gte = new Date(filter.from);
        if (filter.to)
            startsAtFilter.lte = new Date(filter.to);
        const slots = await this.prisma.classSlot.findMany({
            where: {
                unitId: filter.unitId,
                startsAt: Object.keys(startsAtFilter).length > 0 ? startsAtFilter : undefined,
                status: filter.status,
            },
            include: {
                classKind: true,
                instructor: { select: { id: true, name: true } },
                _count: {
                    select: {
                        reservations: {
                            where: {
                                status: { in: ['ACTIVE', 'CHECKED_IN'] },
                            },
                        },
                    },
                },
            },
            orderBy: { startsAt: 'asc' },
        });
        return slots.map(({ _count, ...s }) => ({
            ...s,
            reservedCount: _count.reservations,
            freeSpots: Math.max(0, s.capacity - _count.reservations),
        }));
    }
    async findOne(id) {
        const slot = await this.prisma.classSlot.findUnique({
            where: { id },
            include: { classKind: true },
        });
        if (!slot)
            throw new common_1.NotFoundException('Aula não encontrada');
        return slot;
    }
    async update(id, dto, user) {
        const slot = await this.findOne(id);
        (0, tenancy_1.assertCanManageSlot)(user, slot);
        if (slot.status !== client_1.ClassSlotStatus.SCHEDULED) {
            throw new common_1.BadRequestException('Não é possível editar uma aula cancelada ou finalizada');
        }
        const startsAt = dto.startsAt ? new Date(dto.startsAt) : undefined;
        if (startsAt && (Number.isNaN(startsAt.getTime()) || startsAt <= new Date())) {
            throw new common_1.BadRequestException('A aula precisa começar no futuro');
        }
        if (dto.classKindId) {
            const kind = await this.prisma.classKind.findUnique({
                where: { id: dto.classKindId },
            });
            if (!kind || !kind.isActive) {
                throw new common_1.BadRequestException('Tipo de aula inválido ou inativo');
            }
        }
        return this.prisma.classSlot.update({
            where: { id },
            data: {
                classKindId: dto.classKindId,
                title: dto.title,
                startsAt,
                durationMinutes: dto.durationMinutes,
                capacity: dto.capacity,
            },
        });
    }
    async cancel(id, dto, user) {
        const slot = await this.findOne(id);
        (0, tenancy_1.assertCanManageSlot)(user, slot);
        if (slot.status !== client_1.ClassSlotStatus.SCHEDULED) {
            throw new common_1.BadRequestException('Aula já está em estado final');
        }
        const isOutro = (dto.kind === client_1.CancellationKind.PERSONAL &&
            dto.personalReason === client_1.PersonalCancellationReason.OUTRO) ||
            (dto.kind === client_1.CancellationKind.STUDIO &&
                dto.studioReason === client_1.StudioCancellationReason.OUTRO);
        if (isOutro && (!dto.description || dto.description.trim().length < 3)) {
            throw new common_1.BadRequestException('Descrição obrigatória quando motivo é OUTRO');
        }
        const now = new Date();
        const newStatus = now < slot.startsAt
            ? client_1.ClassSlotStatus.CANCELLED_BEFORE
            : client_1.ClassSlotStatus.CANCELLED_DURING;
        return this.prisma.$transaction(async (tx) => {
            const bulk = await this.reservations.bulkCancelByStudio(id, user.id, tx);
            const waitlistCleared = await this.waitlist.clearForSlot(id, tx);
            const updated = await tx.classSlot.update({
                where: { id },
                data: {
                    status: newStatus,
                    cancellationKind: dto.kind,
                    personalCancellationReason: dto.kind === client_1.CancellationKind.PERSONAL
                        ? dto.personalReason
                        : null,
                    studioCancellationReason: dto.kind === client_1.CancellationKind.STUDIO ? dto.studioReason : null,
                    cancellationDescription: dto.description ?? null,
                    cancelledByUserId: user.id,
                    cancelledAt: now,
                },
            });
            return {
                ...updated,
                reservationsCancelled: bulk.cancelled,
                creditsRefunded: bulk.refunded,
                waitlistCleared,
            };
        });
    }
};
exports.ClassSlotsService = ClassSlotsService;
exports.ClassSlotsService = ClassSlotsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        reservations_service_1.ReservationsService,
        waitlist_service_1.WaitlistService])
], ClassSlotsService);
//# sourceMappingURL=class-slots.service.js.map