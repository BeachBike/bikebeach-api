import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreatePixPackDto } from './dto/create-pix-pack.dto';
import { PaymentsService } from './payments.service';
export declare class PaymentsController {
    private readonly payments;
    constructor(payments: PaymentsService);
    createPixPack(dto: CreatePixPackDto, user: AuthenticatedUser): Promise<import("./payments.service").CreatePixPackResult>;
    listMine(user: AuthenticatedUser): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        method: import("@prisma/client").$Enums.PaymentMethod;
        userId: string;
        status: import("@prisma/client").$Enums.PaymentStatus;
        subscriptionId: string | null;
        kind: import("@prisma/client").$Enums.PaymentKind;
        asaasChargeId: string;
        amountCents: number;
        paidAt: Date | null;
        packCredits: number | null;
        packExpirationDays: number | null;
    }[]>;
}
