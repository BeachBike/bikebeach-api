import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { UsersService } from './users.service';
export declare class UsersController {
    private readonly users;
    constructor(users: UsersService);
    me(user: AuthenticatedUser): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string | null;
        cpf: string | null;
        role: import("@prisma/client").$Enums.Role;
        unitId: string | null;
        isActive: boolean;
        birthDate: Date | null;
        goal: import("@prisma/client").$Enums.UserGoal | null;
        fitnessLevel: import("@prisma/client").$Enums.FitnessLevel | null;
        mustChangePassword: boolean;
        createdAt: Date;
    }>;
    createStaff(dto: CreateStaffUserDto): Promise<{
        id: string;
        email: string;
        name: string;
        role: import("@prisma/client").$Enums.Role;
        unitId: string | null;
        isActive: boolean;
        mustChangePassword: boolean;
        createdAt: Date;
    }>;
}
