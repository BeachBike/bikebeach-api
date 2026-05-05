import { PrismaService } from '../prisma/prisma.service';
import { GrantCreditPackDto } from './dto/grant-credit-pack.dto';
export declare class CreditPacksService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    grant(dto: GrantCreditPackDto): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date | null;
        source: import("@prisma/client").$Enums.CreditSource;
        totalCredits: number;
        remainingCredits: number;
        subscriptionId: string | null;
        paymentId: string | null;
    }>;
    findActiveForUser(userId: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date | null;
        source: import("@prisma/client").$Enums.CreditSource;
        totalCredits: number;
        remainingCredits: number;
        subscriptionId: string | null;
        paymentId: string | null;
    }[]>;
    findAllForUser(userId: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date | null;
        source: import("@prisma/client").$Enums.CreditSource;
        totalCredits: number;
        remainingCredits: number;
        subscriptionId: string | null;
        paymentId: string | null;
    }[]>;
    expireOverduePacks(): Promise<number>;
    runDailyExpiryJob(): Promise<void>;
}
