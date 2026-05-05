import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';
export declare class SubscriptionsController {
    private readonly subscriptions;
    constructor(subscriptions: SubscriptionsService);
    create(dto: CreateSubscriptionDto, user: AuthenticatedUser): Promise<{
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
    listMine(user: AuthenticatedUser): Promise<({
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
    cancel(id: string, user: AuthenticatedUser): Promise<{
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
}
