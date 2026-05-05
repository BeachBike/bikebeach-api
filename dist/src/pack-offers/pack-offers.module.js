"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackOffersModule = void 0;
const common_1 = require("@nestjs/common");
const pack_offers_controller_1 = require("./pack-offers.controller");
const pack_offers_service_1 = require("./pack-offers.service");
let PackOffersModule = class PackOffersModule {
};
exports.PackOffersModule = PackOffersModule;
exports.PackOffersModule = PackOffersModule = __decorate([
    (0, common_1.Module)({
        controllers: [pack_offers_controller_1.PackOffersController],
        providers: [pack_offers_service_1.PackOffersService],
        exports: [pack_offers_service_1.PackOffersService],
    })
], PackOffersModule);
//# sourceMappingURL=pack-offers.module.js.map