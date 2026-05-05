import { PrismaService } from '../prisma/prisma.service';
import { CreateClassKindDto } from './dto/create-class-kind.dto';
import { UpdateClassKindDto } from './dto/update-class-kind.dto';
export declare class ClassKindsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateClassKindDto): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        displayOrder: number;
        defaultDurationMinutes: number;
        intensity: number;
        tone: string | null;
    }>;
    listActive(): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        displayOrder: number;
        defaultDurationMinutes: number;
        intensity: number;
        tone: string | null;
    }[]>;
    listAll(): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        displayOrder: number;
        defaultDurationMinutes: number;
        intensity: number;
        tone: string | null;
    }[]>;
    findOne(id: string): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        displayOrder: number;
        defaultDurationMinutes: number;
        intensity: number;
        tone: string | null;
    }>;
    update(id: string, dto: UpdateClassKindDto): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        displayOrder: number;
        defaultDurationMinutes: number;
        intensity: number;
        tone: string | null;
    }>;
    deactivate(id: string): Promise<void>;
}
