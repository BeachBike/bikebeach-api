import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreatePackOfferDto } from './dto/create-pack-offer.dto';
import { UpdatePackOfferDto } from './dto/update-pack-offer.dto';
import { PackOffersService } from './pack-offers.service';
export declare class PackOffersController {
    private readonly offers;
    constructor(offers: PackOffersService);
    list(unitId: string): Promise<{
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
    listAdmin(unitId: string, user: AuthenticatedUser): Promise<{
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
