import { AsaasClientService } from '../asaas/asaas-client.service';
import { AsaasCustomersService } from '../asaas/asaas-customers.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
export declare class SubscriptionsService {
    private readonly prisma;
    private readonly asaas;
    private readonly customers;
    private readonly logger;
    constructor(prisma: PrismaService, asaas: AsaasClientService, customers: AsaasCustomersService);
    create(userId: string, dto: CreateSubscriptionDto): Promise<{
        plan: {
            id: string;
            name: string;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
            priceCents: number;
            monthlyCredits: number;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        status: import("@prisma/client").$Enums.SubscriptionStatus;
        cancelledAt: Date | null;
        asaasSubscriptionId: string | null;
        planId: string;
        currentPeriodStart: Date;
        currentPeriodEnd: Date;
    }>;
    cancel(id: string, requester: AuthenticatedUser): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        status: import("@prisma/client").$Enums.SubscriptionStatus;
        cancelledAt: Date | null;
        asaasSubscriptionId: string | null;
        planId: string;
        currentPeriodStart: Date;
        currentPeriodEnd: Date;
    }>;
    findMine(userId: string): Promise<({
        plan: {
            id: string;
            name: string;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
            priceCents: number;
            monthlyCredits: number;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        status: import("@prisma/client").$Enums.SubscriptionStatus;
        cancelledAt: Date | null;
        asaasSubscriptionId: string | null;
        planId: string;
        currentPeriodStart: Date;
        currentPeriodEnd: Date;
    })[]>;
}
