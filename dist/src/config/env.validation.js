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
exports.validateEnv = validateEnv;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const DURATION_REGEX = /^\d+[smhd]$/;
const DURATION_MESSAGE = 'must be like 15m, 7d, 1h (number + s/m/h/d)';
class EnvVars {
    DATABASE_URL;
    JWT_SECRET;
    JWT_ACCESS_EXPIRES_IN = '15m';
    JWT_REFRESH_EXPIRES_IN = '7d';
    ASAAS_ENV;
    ASAAS_API_KEY;
    ASAAS_WEBHOOK_TOKEN;
    PORT = 3000;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EnvVars.prototype, "DATABASE_URL", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(32, {
        message: 'JWT_SECRET must be at least 32 characters. Generate with: openssl rand -hex 32',
    }),
    __metadata("design:type", String)
], EnvVars.prototype, "JWT_SECRET", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(DURATION_REGEX, { message: `JWT_ACCESS_EXPIRES_IN ${DURATION_MESSAGE}` }),
    __metadata("design:type", String)
], EnvVars.prototype, "JWT_ACCESS_EXPIRES_IN", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(DURATION_REGEX, { message: `JWT_REFRESH_EXPIRES_IN ${DURATION_MESSAGE}` }),
    __metadata("design:type", String)
], EnvVars.prototype, "JWT_REFRESH_EXPIRES_IN", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['sandbox', 'production'], {
        message: 'ASAAS_ENV must be "sandbox" or "production"',
    }),
    __metadata("design:type", String)
], EnvVars.prototype, "ASAAS_ENV", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(10, { message: 'ASAAS_API_KEY is required' }),
    __metadata("design:type", String)
], EnvVars.prototype, "ASAAS_API_KEY", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(20, {
        message: 'ASAAS_WEBHOOK_TOKEN must be at least 20 chars (mirror the value you set in Asaas dashboard)',
    }),
    __metadata("design:type", String)
], EnvVars.prototype, "ASAAS_WEBHOOK_TOKEN", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], EnvVars.prototype, "PORT", void 0);
function validateEnv(config) {
    const validated = (0, class_transformer_1.plainToInstance)(EnvVars, config, {
        enableImplicitConversion: true,
    });
    const errors = (0, class_validator_1.validateSync)(validated, { skipMissingProperties: false });
    if (errors.length > 0) {
        throw new Error(`Invalid environment configuration:\n${errors
            .map((e) => `  - ${e.toString()}`)
            .join('\n')}`);
    }
    return validated;
}
//# sourceMappingURL=env.validation.js.map