import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { WaitlistService } from './waitlist.service';
export declare class WaitlistController {
    private readonly waitlist;
    constructor(waitlist: WaitlistService);
    join(slotId: string, user: AuthenticatedUser): Promise<{
        id: string;
        userId: string;
        classSlotId: string;
        joinedAt: Date;
        promotedAt: Date | null;
        removedAt: Date | null;
    }>;
    leave(slotId: string, user: AuthenticatedUser): Promise<void>;
    list(slotId: string, user: AuthenticatedUser): Promise<({
        user: {
            id: string;
            email: string;
            name: string;
        };
    } & {
        id: string;
        userId: string;
        classSlotId: string;
        joinedAt: Date;
        promotedAt: Date | null;
        removedAt: Date | null;
    })[]>;
}
