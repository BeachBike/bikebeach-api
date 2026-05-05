import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
export declare class UsersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
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
    findById(id: string): Promise<{
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
}
