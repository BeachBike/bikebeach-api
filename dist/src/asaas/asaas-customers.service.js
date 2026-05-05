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
exports.AsaasCustomersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const asaas_client_service_1 = require("./asaas-client.service");
let AsaasCustomersService = class AsaasCustomersService {
    prisma;
    asaas;
    constructor(prisma, asaas) {
        this.prisma = prisma;
        this.asaas = asaas;
    }
    async ensureCustomer(user) {
        if (user.asaasCustomerId)
            return user.asaasCustomerId;
        if (!user.cpf) {
            throw new common_1.BadRequestException({
                code: 'CPF_REQUIRED',
                message: 'Informe seu CPF antes de comprar',
            });
        }
        const customer = await this.asaas.createCustomer({
            name: user.name,
            email: user.email,
            cpfCnpj: user.cpf,
            mobilePhone: user.phone ?? undefined,
        });
        await this.prisma.user.update({
            where: { id: user.id },
            data: { asaasCustomerId: customer.id },
        });
        return customer.id;
    }
};
exports.AsaasCustomersService = AsaasCustomersService;
exports.AsaasCustomersService = AsaasCustomersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        asaas_client_service_1.AsaasClientService])
], AsaasCustomersService);
//# sourceMappingURL=asaas-customers.service.js.map