import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClassKindDto } from './dto/create-class-kind.dto';
import { UpdateClassKindDto } from './dto/update-class-kind.dto';

@Injectable()
export class ClassKindsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateClassKindDto) {
    try {
      return await this.prisma.classKind.create({ data: dto });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Já existe um tipo de aula com esse slug');
      }
      throw err;
    }
  }

  /// Public — used by the instructor-facing slot-creation form to populate the
  /// "kind" picker. Drops inactive ones.
  async listActive() {
    return this.prisma.classKind.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /// Admin — includes inactive so admin can re-enable.
  async listAll() {
    return this.prisma.classKind.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const kind = await this.prisma.classKind.findUnique({ where: { id } });
    if (!kind) throw new NotFoundException('Tipo de aula não encontrado');
    return kind;
  }

  async update(id: string, dto: UpdateClassKindDto) {
    await this.findOne(id);
    return this.prisma.classKind.update({ where: { id }, data: dto });
  }

  async deactivate(id: string) {
    await this.findOne(id);
    await this.prisma.classKind.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
