"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClassSlotsModule = void 0;
const common_1 = require("@nestjs/common");
const reservations_module_1 = require("../reservations/reservations.module");
const waitlist_module_1 = require("../waitlist/waitlist.module");
const class_slots_controller_1 = require("./class-slots.controller");
const class_slots_service_1 = require("./class-slots.service");
let ClassSlotsModule = class ClassSlotsModule {
};
exports.ClassSlotsModule = ClassSlotsModule;
exports.ClassSlotsModule = ClassSlotsModule = __decorate([
    (0, common_1.Module)({
        imports: [reservations_module_1.ReservationsModule, waitlist_module_1.WaitlistModule],
        controllers: [class_slots_controller_1.ClassSlotsController],
        providers: [class_slots_service_1.ClassSlotsService],
        exports: [class_slots_service_1.ClassSlotsService],
    })
], ClassSlotsModule);
//# sourceMappingURL=class-slots.module.js.map