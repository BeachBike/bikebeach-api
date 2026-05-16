import { Module } from '@nestjs/common';
import { BikeHoldsModule } from '../bike-holds/bike-holds.module';
import { HealthGateModule } from '../health-gate/health-gate.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [HealthGateModule, WaitlistModule, BikeHoldsModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
