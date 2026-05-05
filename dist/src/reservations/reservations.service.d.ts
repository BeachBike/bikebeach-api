import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { HealthGateService } from '../health-gate/health-gate.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
export declare class ReservationsService {
    private readonly prisma;
    private readonly healthGate;
    private readonly waitlist;
    private readonly logger;
    constructor(prisma: PrismaService, healthGate: HealthGateService, waitlist: WaitlistService);
    create(dto: CreateReservationDto, user: AuthenticatedUser): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        status: import("@prisma/client").$Enums.ReservationStatus;
        cancelledByUserId: string | null;
        cancelledAt: Date | null;
        classSlotId: string;
        promotedFromWaitlist: boolean;
        activeKey: string | null;
        checkedInAt: Date | null;
        bikeId: string;
        creditPackId: string;
    }>;
    cancelByUser(reservationId: string, user: AuthenticatedUser): Promise<{
        id: string;
        status: "CANCELLED_BY_USER";
        creditReturned: boolean;
        waitlistPromoted: boolean;
    }>;
    checkIn(reservationId: string, user: AuthenticatedUser): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        status: import("@prisma/client").$Enums.ReservationStatus;
        cancelledByUserId: string | null;
        cancelledAt: Date | null;
        classSlotId: string;
        promotedFromWaitlist: boolean;
        activeKey: string | null;
        checkedInAt: Date | null;
        bikeId: string;
        creditPackId: string;
    }>;
    bulkCancelByStudio(slotId: string, cancelledByUserId: string, tx: Prisma.TransactionClient): Promise<{
        cancelled: number;
        refunded: number;
    }>;
    findMine(user: AuthenticatedUser): Promise<({
        bike: {
            id: string;
            unitId: string;
            createdAt: Date;
            updatedAt: Date;
            label: string;
            positionX: number | null;
            positionY: number | null;
            notes: string | null;
            status: import("@prisma/client").$Enums.BikeStatus;
        };
        classSlot: {
            classKind: {
                id: string;
                name: string;
                isActive: boolean;
                createdAt: Date;
                updatedAt: Date;
                slug: string;
                displayOrder: number;
                defaultDurationMinutes: number;
                intensity: number;
                tone: string | null;
            } | null;
            instructor: {
                id: string;
                name: string;
            };
        } & {
            id: string;
            unitId: string;
            createdAt: Date;
            updatedAt: Date;
            status: import("@prisma/client").$Enums.ClassSlotStatus;
            instructorId: string;
            classKindId: string | null;
            title: string | null;
            startsAt: Date;
            durationMinutes: number;
            capacity: number;
            cancellationKind: import("@prisma/client").$Enums.CancellationKind | null;
            personalCancellationReason: import("@prisma/client").$Enums.PersonalCancellationReason | null;
            studioCancellationReason: import("@prisma/client").$Enums.StudioCancellationReason | null;
            cancellationDescription: string | null;
            cancelledByUserId: string | null;
            cancelledAt: Date | null;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        status: import("@prisma/client").$Enums.ReservationStatus;
        cancelledByUserId: string | null;
        cancelledAt: Date | null;
        classSlotId: string;
        promotedFromWaitlist: boolean;
        activeKey: string | null;
        checkedInAt: Date | null;
        bikeId: string;
        creditPackId: string;
    })[]>;
    findOne(id: string, user: AuthenticatedUser): Promise<{
        bike: {
            id: string;
            unitId: string;
            createdAt: Date;
            updatedAt: Date;
            label: string;
            positionX: number | null;
            positionY: number | null;
            notes: string | null;
            status: import("@prisma/client").$Enums.BikeStatus;
        };
        classSlot: {
            classKind: {
                id: string;
                name: string;
                isActive: boolean;
                createdAt: Date;
                updatedAt: Date;
                slug: string;
                displayOrder: number;
                defaultDurationMinutes: number;
                intensity: number;
                tone: string | null;
            } | null;
            instructor: {
                id: string;
                name: string;
            };
        } & {
            id: string;
            unitId: string;
            createdAt: Date;
            updatedAt: Date;
            status: import("@prisma/client").$Enums.ClassSlotStatus;
            instructorId: string;
            classKindId: string | null;
            title: string | null;
            startsAt: Date;
            durationMinutes: number;
            capacity: number;
            cancellationKind: import("@prisma/client").$Enums.CancellationKind | null;
            personalCancellationReason: import("@prisma/client").$Enums.PersonalCancellationReason | null;
            studioCancellationReason: import("@prisma/client").$Enums.StudioCancellationReason | null;
            cancellationDescription: string | null;
            cancelledByUserId: string | null;
            cancelledAt: Date | null;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        status: import("@prisma/client").$Enums.ReservationStatus;
        cancelledByUserId: string | null;
        cancelledAt: Date | null;
        classSlotId: string;
        promotedFromWaitlist: boolean;
        activeKey: string | null;
        checkedInAt: Date | null;
        bikeId: string;
        creditPackId: string;
    }>;
    private activeKeyFor;
}
