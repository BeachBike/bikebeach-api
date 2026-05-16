import { Module } from '@nestjs/common';
import { BikeHoldsModule } from '../bike-holds/bike-holds.module';
import { ClassSlotsModule } from '../class-slots/class-slots.module';
import { PaymentsModule } from '../payments/payments.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { BikeHoldJobsService } from './bike-hold-jobs.service';
import { ClassSlotJobsService } from './class-slot-jobs.service';
import { HealthGateExpiringJobsService } from './health-gate-expiring-jobs.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { ReservationReminderJobsService } from './reservation-reminder-jobs.service';

/// Houses background cron jobs. The ScheduleModule (registered globally in
/// AppModule) discovers `@Cron(...)` decorators on providers it sees, so
/// adding a service here is enough — no manual registration.
@Module({
  imports: [
    ClassSlotsModule,
    WaitlistModule,
    PaymentsModule,
    BikeHoldsModule,
  ],
  providers: [
    ClassSlotJobsService,
    PaymentReconciliationService,
    ReservationReminderJobsService,
    HealthGateExpiringJobsService,
    BikeHoldJobsService,
  ],
})
export class JobsModule {}
