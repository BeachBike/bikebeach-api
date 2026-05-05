import type { Role } from '@prisma/client';
export interface JwtPayload {
    sub: string;
    email: string;
    role: Role;
    unitId: string | null;
    iat?: number;
    exp?: number;
}
