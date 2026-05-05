import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePackOfferDto } from './dto/create-pack-offer.dto';
import { UpdatePackOfferDto } from './dto/update-pack-offer.dto';
export declare class PackOffersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(dto: CreatePackOfferDto, user: AuthenticatedUser): Promise<{
        id: string;
        unitId: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        classes: number;
        priceCents: number;
        expirationDays: number;
        displayOrder: number;
    }>;
    listPublic(unitId: string): Promise<{
        id: string;
        unitId: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        classes: number;
        priceCents: number;
        expirationDays: number;
        displayOrder: number;
    }[]>;
    listForAdmin(unitId: string, user: AuthenticatedUser): Promise<{
        id: string;
        unitId: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        classes: number;
        priceCents: number;
        expirationDays: number;
        displayOrder: number;
    }[]>;
    findOne(id: string): Promise<{
        id: string;
        unitId: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        classes: number;
        priceCents: number;
        expirationDays: number;
        displayOrder: number;
    }>;
    update(id: string, dto: UpdatePackOfferDto, user: AuthenticatedUser): Promise<{
        id: string;
        unitId: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        classes: number;
        priceCents: number;
        expirationDays: number;
        displayOrder: number;
    }>;
    remove(id: string, user: AuthenticatedUser): Promise<void>;
}
