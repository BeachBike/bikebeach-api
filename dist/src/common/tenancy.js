"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGlobalAdmin = isGlobalAdmin;
exports.assertCanAccessUnit = assertCanAccessUnit;
exports.assertCanManageSlot = assertCanManageSlot;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
function isGlobalAdmin(user) {
    return user.role === client_1.Role.ADMIN && user.unitId === null;
}
function assertCanAccessUnit(user, unitId) {
    if (isGlobalAdmin(user))
        return;
    if ((user.role === client_1.Role.ADMIN || user.role === client_1.Role.INSTRUCTOR) &&
        user.unitId === unitId) {
        return;
    }
    throw new common_1.ForbiddenException('Você não tem permissão para acessar essa unidade');
}
function assertCanManageSlot(user, slot) {
    if (isGlobalAdmin(user))
        return;
    if (user.role === client_1.Role.INSTRUCTOR &&
        slot.instructorId === user.id &&
        user.unitId === slot.unitId) {
        return;
    }
    if (user.role === client_1.Role.ADMIN && user.unitId === slot.unitId)
        return;
    throw new common_1.ForbiddenException('Você não pode gerenciar essa aula');
}
//# sourceMappingURL=tenancy.js.map