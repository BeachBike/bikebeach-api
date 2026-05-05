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
exports.ClassSlotsController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const public_decorator_1 = require("../common/decorators/public.decorator");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const class_slots_service_1 = require("./class-slots.service");
const cancel_class_slot_dto_1 = require("./dto/cancel-class-slot.dto");
const create_class_slot_dto_1 = require("./dto/create-class-slot.dto");
const update_class_slot_dto_1 = require("./dto/update-class-slot.dto");
let ClassSlotsController = class ClassSlotsController {
    slots;
    constructor(slots) {
        this.slots = slots;
    }
    create(dto, user) {
        return this.slots.create(dto, user);
    }
    list(unitId, from, to, status) {
        if (!unitId) {
            throw new common_1.BadRequestException('unitId é obrigatório');
        }
        let parsedStatus;
        if (status) {
            if (!(status in client_1.ClassSlotStatus)) {
                throw new common_1.BadRequestException('status inválido');
            }
            parsedStatus = status;
        }
        return this.slots.list({ unitId, from, to, status: parsedStatus });
    }
    findOne(id) {
        return this.slots.findOne(id);
    }
    update(id, dto, user) {
        return this.slots.update(id, dto, user);
    }
    cancel(id, dto, user) {
        return this.slots.cancel(id, dto, user);
    }
};
exports.ClassSlotsController = ClassSlotsController;
__decorate([
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.INSTRUCTOR),
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_class_slot_dto_1.CreateClassSlotDto, Object]),
    __metadata("design:returntype", void 0)
], ClassSlotsController.prototype, "create", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('unitId')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], ClassSlotsController.prototype, "list", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ClassSlotsController.prototype, "findOne", null);
__decorate([
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.INSTRUCTOR),
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_class_slot_dto_1.UpdateClassSlotDto, Object]),
    __metadata("design:returntype", void 0)
], ClassSlotsController.prototype, "update", null);
__decorate([
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.INSTRUCTOR),
    (0, common_1.Post)(':id/cancel'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, cancel_class_slot_dto_1.CancelClassSlotDto, Object]),
    __metadata("design:returntype", void 0)
], ClassSlotsController.prototype, "cancel", null);
exports.ClassSlotsController = ClassSlotsController = __decorate([
    (0, common_1.Controller)('class-slots'),
    __metadata("design:paramtypes", [class_slots_service_1.ClassSlotsService])
], ClassSlotsController);
//# sourceMappingURL=class-slots.controller.js.map