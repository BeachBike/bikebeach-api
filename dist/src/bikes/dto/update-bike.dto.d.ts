import { BikeStatus } from '@prisma/client';
export declare class UpdateBikeDto {
    label?: string;
    positionX?: number;
    positionY?: number;
    notes?: string;
    status?: BikeStatus;
}
