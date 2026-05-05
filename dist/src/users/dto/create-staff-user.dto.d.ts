declare const STAFF_ROLES: readonly ["INSTRUCTOR", "ADMIN"];
type StaffRole = (typeof STAFF_ROLES)[number];
export declare class CreateStaffUserDto {
    email: string;
    password: string;
    name: string;
    role: StaffRole;
    unitId?: string;
}
export {};
