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
exports.PackOffersService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const tenancy_1 = require("../common/tenancy");
const prisma_service_1 = require("../prisma/prisma.service");
let PackOffersService = class PackOffersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto, user) {
        (0, tenancy_1.assertCanAccessUnit)(user, dto.unitId);
        const unit = await this.prisma.unit.findUnique({
            where: { id: dto.unitId },
        });
        if (!unit || !unit.isActive) {
            throw new common_1.BadRequestException('Unidade inválida ou inativa');
        }
        try {
            return await this.prisma.packOffer.create({ data: dto });
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
                throw new common_1.ConflictException('Já existe um pacote com esse número de aulas nessa unidade — edite o existente');
            }
            throw err;
        }
    }
    async listPublic(unitId) {
        return this.prisma.packOffer.findMany({
            where: { unitId, isActive: true },
            orderBy: [{ displayOrder: 'asc' }, { classes: 'asc' }],
        });
    }
    async listForAdmin(unitId, user) {
        (0, tenancy_1.assertCanAccessUnit)(user, unitId);
        return this.prisma.packOffer.findMany({
            where: { unitId },
            orderBy: [{ displayOrder: 'asc' }, { classes: 'asc' }],
        });
    }
    async findOne(id) {
        const offer = await this.prisma.packOffer.findUnique({ where: { id } });
        if (!offer)
            throw new common_1.NotFoundException('Pacote não encontrado');
        return offer;
    }
    async update(id, dto, user) {
        const existing = await this.findOne(id);
        (0, tenancy_1.assertCanAccessUnit)(user, existing.unitId);
        return this.prisma.packOffer.update({ where: { id }, data: dto });
    }
    async remove(id, user) {
        const existing = await this.findOne(id);
        (0, tenancy_1.assertCanAccessUnit)(user, existing.unitId);
        await this.prisma.packOffer.update({
            where: { id },
            data: { isActive: false },
        });
    }
};
exports.PackOffersService = PackOffersService;
exports.PackOffersService = PackOffersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PackOffersService);
//# sourceMappingURL=pack-offers.service.js.map