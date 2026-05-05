import type { Request } from 'express';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AcceptLiabilityDto } from './dto/accept-liability.dto';
import { SubmitParqDto } from './dto/submit-parq.dto';
import { HealthGateService } from './health-gate.service';
export declare class HealthGateController {
    private readonly healthGate;
    constructor(healthGate: HealthGateService);
    status(user: AuthenticatedUser): Promise<import("./health-gate.service").HealthGateStatus>;
    acceptLiability(dto: AcceptLiabilityDto, user: AuthenticatedUser, req: Request): Promise<{
        id: string;
        userId: string;
        userAgent: string | null;
        version: string;
        ipAddress: string | null;
        acceptedAt: Date;
    }>;
    submitParq(dto: SubmitParqDto, user: AuthenticatedUser, req: Request): Promise<{
        id: string;
        userId: string;
        userAgent: string | null;
        version: string;
        answers: import("@prisma/client/runtime/library").JsonValue;
        ipAddress: string | null;
        acceptedAt: Date;
    }>;
}
