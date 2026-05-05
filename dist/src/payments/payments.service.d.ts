import { AsaasClientService } from '../asaas/asaas-client.service';
import type { AsaasPayment } from '../asaas/asaas-client.types';
import { AsaasCustomersService } from '../asaas/asaas-customers.service';
import { PrismaService } from '../prisma/prisma.service';
export interface CreatePixPackResult {
    paymentId: string;
    asaasChargeId: string;
    amountCents: number;
    basePriceCents: number;
    pixDiscountPercent: number;
    pix: {
        qrCodeImage: string;
        qrCodePayload: string;
        expiresAt: string;
    };
}
export declare class PaymentsService {
    private readonly prisma;
    private readonly asaas;
    private readonly customers;
    private readonly logger;
    constructor(prisma: PrismaService, asaas: AsaasClientService, customers: AsaasCustomersService);
    createPixPackCharge(userId: string, packOfferId: string): Promise<CreatePixPackResult>;
    applyPaymentConfirmation(asaasPayment: AsaasPayment): Promise<void>;
    upsertSubscriptionCyclePayment(asaasPayment: AsaasPayment): Promise<void>;
    findMine(userId: string): Promise<{
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
