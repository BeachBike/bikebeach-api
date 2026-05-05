import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreditPacksService } from './credit-packs.service';
import { GrantCreditPackDto } from './dto/grant-credit-pack.dto';
export declare class CreditPacksController {
    private readonly packs;
    constructor(packs: CreditPacksService);
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
    listMine(user: AuthenticatedUser, includeExpired?: string): Promise<{
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
}
