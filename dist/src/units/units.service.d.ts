import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
export declare class UnitsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateUnitDto, user: AuthenticatedUser): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        address: string;
        lateCheckinToleranceMinutes: number;
        pixDiscountPercent: number;
    }>;
    findAll(includeInactive?: boolean): Promise<{
        operationalBikeCount: number;
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        address: string;
        lateCheckinToleranceMinutes: number;
        pixDiscountPercent: number;
    }[]>;
    findOne(id: string): Promise<{
        operationalBikeCount: number;
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        address: string;
        lateCheckinToleranceMinutes: number;
        pixDiscountPercent: number;
    }>;
    update(id: string, dto: UpdateUnitDto, user: AuthenticatedUser): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        address: string;
        lateCheckinToleranceMinutes: number;
        pixDiscountPercent: number;
    }>;
    deactivate(id: string, user: AuthenticatedUser): Promise<void>;
}
