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
exports.BikesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const tenancy_1 = require("../common/tenancy");
const prisma_service_1 = require("../prisma/prisma.service");
let BikesService = class BikesService {
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
            return await this.prisma.bike.create({ data: dto });
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
                throw new common_1.ConflictException('Já existe uma bike com esse label nessa unidade');
            }
            throw err;
        }
    }
    async findByUnit(unitId, includeAll = false) {
        return this.prisma.bike.findMany({
            where: {
                unitId,
                ...(includeAll ? {} : { status: client_1.BikeStatus.OPERATIONAL }),
            },
            orderBy: { label: 'asc' },
        });
    }
    async findOne(id) {
        const bike = await this.prisma.bike.findUnique({ where: { id } });
        if (!bike)
            throw new common_1.NotFoundException('Bike não encontrada');
        return bike;
    }
    async update(id, dto, user) {
        const bike = await this.findOne(id);
        (0, tenancy_1.assertCanAccessUnit)(user, bike.unitId);
        try {
            return await this.prisma.bike.update({ where: { id }, data: dto });
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
                throw new common_1.ConflictException('Já existe uma bike com esse label nessa unidade');
            }
            throw err;
        }
    }
    async deactivate(id, user) {
        const bike = await this.findOne(id);
        (0, tenancy_1.assertCanAccessUnit)(user, bike.unitId);
        await this.prisma.bike.update({
            where: { id },
            data: { status: client_1.BikeStatus.OUT_OF_SERVICE },
        });
    }
};
exports.BikesService = BikesService;
exports.BikesService = BikesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], BikesService);
//# sourceMappingURL=bikes.service.js.map