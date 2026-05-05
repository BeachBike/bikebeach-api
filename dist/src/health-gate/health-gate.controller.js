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
exports.HealthGateController = void 0;
const common_1 = require("@nestjs/common");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const accept_liability_dto_1 = require("./dto/accept-liability.dto");
const submit_parq_dto_1 = require("./dto/submit-parq.dto");
const health_gate_service_1 = require("./health-gate.service");
let HealthGateController = class HealthGateController {
    healthGate;
    constructor(healthGate) {
        this.healthGate = healthGate;
    }
    status(user) {
        return this.healthGate.getStatus(user.id);
    }
    acceptLiability(dto, user, req) {
        return this.healthGate.acceptLiability(user.id, dto.version, {
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });
    }
    submitParq(dto, user, req) {
        return this.healthGate.submitParq(user.id, dto.version, dto.answers, {
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });
    }
};
exports.HealthGateController = HealthGateController;
__decorate([
    (0, common_1.Get)('health-gate/status'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], HealthGateController.prototype, "status", null);
__decorate([
    (0, common_1.Post)('liability/accept'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [accept_liability_dto_1.AcceptLiabilityDto, Object, Object]),
    __metadata("design:returntype", void 0)
], HealthGateController.prototype, "acceptLiability", null);
__decorate([
    (0, common_1.Post)('parq/submit'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [submit_parq_dto_1.SubmitParqDto, Object, Object]),
    __metadata("design:returntype", void 0)
], HealthGateController.prototype, "submitParq", null);
exports.HealthGateController = HealthGateController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [health_gate_service_1.HealthGateService])
], HealthGateController);
//# sourceMappingURL=health-gate.controller.js.map