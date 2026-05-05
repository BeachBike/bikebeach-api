"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const asaas_module_1 = require("./asaas/asaas.module");
const auth_module_1 = require("./auth/auth.module");
const bikes_module_1 = require("./bikes/bikes.module");
const class_kinds_module_1 = require("./class-kinds/class-kinds.module");
const class_slots_module_1 = require("./class-slots/class-slots.module");
const env_validation_1 = require("./config/env.validation");
const credit_packs_module_1 = require("./credit-packs/credit-packs.module");
const health_module_1 = require("./health/health.module");
const health_gate_module_1 = require("./health-gate/health-gate.module");
const pack_offers_module_1 = require("./pack-offers/pack-offers.module");
const payments_module_1 = require("./payments/payments.module");
const plans_module_1 = require("./plans/plans.module");
const prisma_module_1 = require("./prisma/prisma.module");
const reservations_module_1 = require("./reservations/reservations.module");
const subscriptions_module_1 = require("./subscriptions/subscriptions.module");
const units_module_1 = require("./units/units.module");
const users_module_1 = require("./users/users.module");
const waitlist_module_1 = require("./waitlist/waitlist.module");
const webhooks_module_1 = require("./webhooks/webhooks.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                validate: env_validation_1.validateEnv,
            }),
            schedule_1.ScheduleModule.forRoot(),
            prisma_module_1.PrismaModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            units_module_1.UnitsModule,
            bikes_module_1.BikesModule,
            class_kinds_module_1.ClassKindsModule,
            class_slots_module_1.ClassSlotsModule,
            plans_module_1.PlansModule,
            pack_offers_module_1.PackOffersModule,
            health_gate_module_1.HealthGateModule,
            credit_packs_module_1.CreditPacksModule,
            waitlist_module_1.WaitlistModule,
            reservations_module_1.ReservationsModule,
            asaas_module_1.AsaasModule,
            payments_module_1.PaymentsModule,
            subscriptions_module_1.SubscriptionsModule,
            webhooks_module_1.WebhooksModule,
            health_module_1.HealthModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map