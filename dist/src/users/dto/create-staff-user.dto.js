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
exports.CreateStaffUserDto = void 0;
const client_1 = require("@prisma/client");
const class_validator_1 = require("class-validator");
const STAFF_ROLES = [client_1.Role.INSTRUCTOR, client_1.Role.ADMIN];
class CreateStaffUserDto {
    email;
    password;
    name;
    role;
    unitId;
}
exports.CreateStaffUserDto = CreateStaffUserDto;
__decorate([
    (0, class_validator_1.IsEmail)(),
    __metadata("design:type", String)
], CreateStaffUserDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(8, { message: 'Senha precisa ter no mínimo 8 caracteres' }),
    (0, class_validator_1.MaxLength)(72),
    __metadata("design:type", String)
], CreateStaffUserDto.prototype, "password", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], CreateStaffUserDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsIn)(STAFF_ROLES, {
        message: 'Role precisa ser INSTRUCTOR ou ADMIN',
    }),
    __metadata("design:type", String)
], CreateStaffUserDto.prototype, "role", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateStaffUserDto.prototype, "unitId", void 0);
//# sourceMappingURL=create-staff-user.dto.js.map