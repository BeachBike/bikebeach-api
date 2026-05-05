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
exports.UnitsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const tenancy_1 = require("../common/tenancy");
const prisma_service_1 = require("../prisma/prisma.service");
let UnitsService = class UnitsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto, user) {
        if (!(0, tenancy_1.isGlobalAdmin)(user)) {
            throw new common_1.ForbiddenException('Apenas admin global pode criar unidades');
        }
        try {
            return await this.prisma.unit.create({ data: dto });
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
                throw new common_1.ConflictException('Slug já em uso');
            }
            throw err;
        }
    }
    async findAll(includeInactive = false) {
        const units = await this.prisma.unit.findMany({
            where: includeInactive ? {} : { isActive: true },
            orderBy: { name: 'asc' },
            include: {
                _count: {
                    select: { bikes: { where: { status: client_1.BikeStatus.OPERATIONAL } } },
                },
            },
        });
        return units.map(({ _count, ...u }) => ({
            ...u,
            operationalBikeCount: _count.bikes,
        }));
    }
    async findOne(id) {
        const unit = await this.prisma.unit.findUnique({
            where: { id },
            include: {
                _count: {
                    select: { bikes: { where: { status: client_1.BikeStatus.OPERATIONAL } } },
                },
            },
        });
        if (!unit)
            throw new common_1.NotFoundException('Unidade não encontrada');
        const { _count, ...rest } = unit;
        return { ...rest, operationalBikeCount: _count.bikes };
    }
    async update(id, dto, user) {
        const unit = await this.findOne(id);
        (0, tenancy_1.assertCanAccessUnit)(user, unit.id);
        return this.prisma.unit.update({ where: { id }, data: dto });
    }
    async deactivate(id, user) {
        if (!(0, tenancy_1.isGlobalAdmin)(user)) {
            throw new common_1.ForbiddenException('Apenas admin global pode desativar unidades');
        }
        await this.findOne(id);
        await this.prisma.unit.update({
            where: { id },
            data: { isActive: false },
        });
    }
};
exports.UnitsService = UnitsService;
exports.UnitsService = UnitsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UnitsService);
//# sourceMappingURL=units.service.js.map