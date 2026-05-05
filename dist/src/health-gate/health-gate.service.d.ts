import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
interface AcceptanceContext {
    ipAddress?: string;
    userAgent?: string;
}
interface GateField {
    version: string | null;
    acceptedAt: Date | null;
    expiresAt: Date | null;
    valid: boolean;
}
export interface HealthGateStatus {
    liability: GateField;
    parq: GateField;
    ok: boolean;
}
export declare class HealthGateService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getStatus(userId: string): Promise<HealthGateStatus>;
    assertValid(userId: string): Promise<void>;
    acceptLiability(userId: string, version: string, ctx: AcceptanceContext): Promise<{
        id: string;
        userId: string;
        userAgent: string | null;
        version: string;
        ipAddress: string | null;
        acceptedAt: Date;
    }>;
    submitParq(userId: string, version: string, answers: Record<string, unknown>, ctx: AcceptanceContext): Promise<{
        id: string;
        userId: string;
        userAgent: string | null;
        version: string;
        answers: Prisma.JsonValue;
        ipAddress: string | null;
        acceptedAt: Date;
    }>;
    private computeField;
}
export {};
