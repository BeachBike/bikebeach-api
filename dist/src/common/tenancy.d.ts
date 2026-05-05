import type { AuthenticatedUser } from './types/authenticated-user.type';
export declare function isGlobalAdmin(user: AuthenticatedUser): boolean;
export declare function assertCanAccessUnit(user: AuthenticatedUser, unitId: string): void;
export declare function assertCanManageSlot(user: AuthenticatedUser, slot: {
    unitId: string;
    instructorId: string;
}): void;
