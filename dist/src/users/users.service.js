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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const bcrypt_1 = require("bcrypt");
const prisma_service_1 = require("../prisma/prisma.service");
const BCRYPT_ROUNDS = 12;
let UsersService = class UsersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createStaff(dto) {
        if (dto.role === client_1.Role.INSTRUCTOR && !dto.unitId) {
            throw new common_1.BadRequestException('Instrutor precisa de unitId');
        }
        if (dto.unitId) {
            const unit = await this.prisma.unit.findUnique({
                where: { id: dto.unitId },
            });
            if (!unit)
                throw new common_1.BadRequestException('Unidade não encontrada');
        }
        const existing = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (existing)
            throw new common_1.ConflictException('E-mail já cadastrado');
        const passwordHash = await (0, bcrypt_1.hash)(dto.password, BCRYPT_ROUNDS);
        return this.prisma.user.create({
            data: {
                email: dto.email,
                passwordHash,
                name: dto.name,
                role: dto.role,
                unitId: dto.unitId,
                mustChangePassword: true,
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                unitId: true,
                isActive: true,
                mustChangePassword: true,
                createdAt: true,
            },
        });
    }
    async findById(id) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                name: true,
                phone: true,
                cpf: true,
                birthDate: true,
                goal: true,
                fitnessLevel: true,
                role: true,
                unitId: true,
                isActive: true,
                mustChangePassword: true,
                createdAt: true,
            },
        });
        if (!user)
            throw new common_1.NotFoundException('Usuário não encontrado');
        return user;
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UsersService);
//# sourceMappingURL=users.service.js.map