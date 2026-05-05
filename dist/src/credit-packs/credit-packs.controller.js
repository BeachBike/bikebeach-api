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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditPacksController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const credit_packs_service_1 = require("./credit-packs.service");
const grant_credit_pack_dto_1 = require("./dto/grant-credit-pack.dto");
let CreditPacksController = class CreditPacksController {
    packs;
    constructor(packs) {
        this.packs = packs;
    }
    grant(dto) {
        return this.packs.grant(dto);
    }
    listMine(user, includeExpired) {
        return includeExpired === 'true'
            ? this.packs.findAllForUser(user.id)
            : this.packs.findActiveForUser(user.id);
    }
};
exports.CreditPacksController = CreditPacksController;
__decorate([
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN),
    (0, common_1.Post)('grant'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [grant_credit_pack_dto_1.GrantCreditPackDto]),
    __metadata("design:returntype", void 0)
], CreditPacksController.prototype, "grant", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('includeExpired')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CreditPacksController.prototype, "listMine", null);
exports.CreditPacksController = CreditPacksController = __decorate([
    (0, common_1.Controller)('credit-packs'),
    __metadata("design:paramtypes", [credit_packs_service_1.CreditPacksService])
], CreditPacksController);
//# sourceMappingURL=credit-packs.controller.js.map