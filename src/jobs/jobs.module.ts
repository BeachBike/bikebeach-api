import { Module } from '@nestjs/common';
import { ClassSlotsModule } from '../class-slots/class-slots.module';
import { PaymentsModule } from '../payments/payments.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { ClassSlotJobsService } from './class-slot-jobs.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';

/// Houses background cron jobs. The ScheduleModule (registered globally in
/// AppModule) discovers `@Cron(...)` decorators on providers it sees, so
/// adding a service here is enough — no manual registration.
@Module({
  imports: [ClassSlotsModule, WaitlistModule, PaymentsModule],
  providers: [ClassSlotJobsService, PaymentReconciliationService],
})
export class JobsModule {}
