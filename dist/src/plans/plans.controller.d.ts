import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlansService } from './plans.service';
export declare class PlansController {
    private readonly plans;
    constructor(plans: PlansService);
    create(dto: CreatePlanDto): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        priceCents: number;
        monthlyCredits: number;
    }>;
    list(includeInactive?: string): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        priceCents: number;
        monthlyCredits: number;
    }[]>;
    findOne(id: string): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        priceCents: number;
        monthlyCredits: number;
    }>;
    update(id: string, dto: UpdatePlanDto): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        priceCents: number;
        monthlyCredits: number;
    }>;
    deactivate(id: string): Promise<void>;
}
