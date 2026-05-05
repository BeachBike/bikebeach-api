import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { HealthGateService } from '../health-gate/health-gate.service';
import { PrismaService } from '../prisma/prisma.service';
export interface PromotionResult {
    reservationId: string;
    promotedUserId: string;
    waitlistEntryId: string;
}
export declare class WaitlistService {
    private readonly prisma;
    private readonly healthGate;
    private readonly logger;
    constructor(prisma: PrismaService, healthGate: HealthGateService);
    join(slotId: string, user: AuthenticatedUser): Promise<{
        id: string;
        userId: string;
        classSlotId: string;
        joinedAt: Date;
        promotedAt: Date | null;
        removedAt: Date | null;
    }>;
    leave(slotId: string, user: AuthenticatedUser): Promise<void>;
    clearForSlot(slotId: string, tx: Prisma.TransactionClient): Promise<number>;
    listFor(slotId: string, requester: AuthenticatedUser): Promise<({
        user: {
            id: string;
            email: string;
            name: string;
        };
    } & {
        id: string;
        userId: string;
        classSlotId: string;
        joinedAt: Date;
        promotedAt: Date | null;
        removedAt: Date | null;
    })[]>;
    tryPromoteAfterCancellation(slotId: string, freedBikeId: string): Promise<PromotionResult | null>;
}
