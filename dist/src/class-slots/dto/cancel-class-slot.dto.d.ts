import { CancellationKind, PersonalCancellationReason, StudioCancellationReason } from '@prisma/client';
export declare class CancelClassSlotDto {
    kind: CancellationKind;
    personalReason?: PersonalCancellationReason;
    studioReason?: StudioCancellationReason;
    description?: string;
}
