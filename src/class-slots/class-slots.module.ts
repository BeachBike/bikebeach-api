import { Module } from '@nestjs/common';
import { ReservationsModule } from '../reservations/reservations.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { ClassSlotsController } from './class-slots.controller';
import { ClassSlotsService } from './class-slots.service';

@Module({
  imports: [ReservationsModule, WaitlistModule],
  controllers: [ClassSlotsController],
  providers: [ClassSlotsService],
  exports: [ClassSlotsService],
})
export class ClassSlotsModule {}
