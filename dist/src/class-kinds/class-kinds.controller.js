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
exports.ClassKindsController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const class_kinds_service_1 = require("./class-kinds.service");
const create_class_kind_dto_1 = require("./dto/create-class-kind.dto");
const update_class_kind_dto_1 = require("./dto/update-class-kind.dto");
let ClassKindsController = class ClassKindsController {
    kinds;
    constructor(kinds) {
        this.kinds = kinds;
    }
    list() {
        return this.kinds.listActive();
    }
    listAdmin() {
        return this.kinds.listAll();
    }
    create(dto) {
        return this.kinds.create(dto);
    }
    update(id, dto) {
        return this.kinds.update(id, dto);
    }
    async deactivate(id) {
        await this.kinds.deactivate(id);
    }
};
exports.ClassKindsController = ClassKindsController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ClassKindsController.prototype, "list", null);
__decorate([
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN),
    (0, common_1.Get)('admin'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ClassKindsController.prototype, "listAdmin", null);
__decorate([
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN),
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_class_kind_dto_1.CreateClassKindDto]),
    __metadata("design:returntype", void 0)
], ClassKindsController.prototype, "create", null);
__decorate([
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN),
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_class_kind_dto_1.UpdateClassKindDto]),
    __metadata("design:returntype", void 0)
], ClassKindsController.prototype, "update", null);
__decorate([
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN),
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ClassKindsController.prototype, "deactivate", null);
exports.ClassKindsController = ClassKindsController = __decorate([
    (0, common_1.Controller)('class-kinds'),
    __metadata("design:paramtypes", [class_kinds_service_1.ClassKindsService])
], ClassKindsController);
//# sourceMappingURL=class-kinds.controller.js.map