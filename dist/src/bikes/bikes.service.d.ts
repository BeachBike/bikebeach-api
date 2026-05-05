import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBikeDto } from './dto/create-bike.dto';
import { UpdateBikeDto } from './dto/update-bike.dto';
export declare class BikesService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateBikeDto, user: AuthenticatedUser): Promise<{
        id: string;
        unitId: string;
        createdAt: Date;
        updatedAt: Date;
        label: string;
        positionX: number | null;
        positionY: number | null;
        notes: string | null;
        status: import("@prisma/client").$Enums.BikeStatus;
    }>;
    findByUnit(unitId: string, includeAll?: boolean): Promise<{
        id: string;
        unitId: string;
        createdAt: Date;
        updatedAt: Date;
        label: string;
        positionX: number | null;
        positionY: number | null;
        notes: string | null;
        status: import("@prisma/client").$Enums.BikeStatus;
    }[]>;
    findOne(id: string): Promise<{
        id: string;
        unitId: string;
        createdAt: Date;
        updatedAt: Date;
        label: string;
        positionX: number | null;
        positionY: number | null;
        notes: string | null;
        status: import("@prisma/client").$Enums.BikeStatus;
    }>;
    update(id: string, dto: UpdateBikeDto, user: AuthenticatedUser): Promise<{
        id: string;
        unitId: string;
        createdAt: Date;
        updatedAt: Date;
        label: string;
        positionX: number | null;
        positionY: number | null;
        notes: string | null;
        status: import("@prisma/client").$Enums.BikeStatus;
    }>;
    deactivate(id: string, user: AuthenticatedUser): Promise<void>;
}
