import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { BikesService } from './bikes.service';
import { CreateBikeDto } from './dto/create-bike.dto';
import { UpdateBikeDto } from './dto/update-bike.dto';
export declare class BikesController {
    private readonly bikes;
    constructor(bikes: BikesService);
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
    list(unitId: string, includeAll?: string): Promise<{
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
