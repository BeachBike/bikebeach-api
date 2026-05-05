"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClassKindsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
let ClassKindsService = class ClassKindsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        try {
            return await this.prisma.classKind.create({ data: dto });
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
                throw new common_1.ConflictException('Já existe um tipo de aula com esse slug');
            }
            throw err;
        }
    }
    async listActive() {
        return this.prisma.classKind.findMany({
            where: { isActive: true },
            orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        });
    }
    async listAll() {
        return this.prisma.classKind.findMany({
            orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        });
    }
    async findOne(id) {
        const kind = await this.prisma.classKind.findUnique({ where: { id } });
        if (!kind)
            throw new common_1.NotFoundException('Tipo de aula não encontrado');
        return kind;
    }
    async update(id, dto) {
        await this.findOne(id);
        return this.prisma.classKind.update({ where: { id }, data: dto });
    }
    async deactivate(id) {
        await this.findOne(id);
        await this.prisma.classKind.update({
            where: { id },
            data: { isActive: false },
        });
    }
};
exports.ClassKindsService = ClassKindsService;
exports.ClassKindsService = ClassKindsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ClassKindsService);
//# sourceMappingURL=class-kinds.service.js.map