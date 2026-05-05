"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsaasModule = void 0;
const common_1 = require("@nestjs/common");
const asaas_client_service_1 = require("./asaas-client.service");
const asaas_customers_service_1 = require("./asaas-customers.service");
let AsaasModule = class AsaasModule {
};
exports.AsaasModule = AsaasModule;
exports.AsaasModule = AsaasModule = __decorate([
    (0, common_1.Module)({
        providers: [asaas_client_service_1.AsaasClientService, asaas_customers_service_1.AsaasCustomersService],
        exports: [asaas_client_service_1.AsaasClientService, asaas_customers_service_1.AsaasCustomersService],
    })
], AsaasModule);
//# sourceMappingURL=asaas.module.js.map