import { ClassKindsService } from './class-kinds.service';
import { CreateClassKindDto } from './dto/create-class-kind.dto';
import { UpdateClassKindDto } from './dto/update-class-kind.dto';
export declare class ClassKindsController {
    private readonly kinds;
    constructor(kinds: ClassKindsService);
    list(): Promise<{
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
    listAdmin(): Promise<{
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
