import { FitnessLevel, UserGoal } from '@prisma/client';
export declare class SignupDto {
    email: string;
    password: string;
    name: string;
    phone?: string;
    cpf?: string;
    birthDate?: string;
    goal?: UserGoal;
    fitnessLevel?: FitnessLevel;
}
