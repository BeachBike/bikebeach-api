import { Module } from '@nestjs/common';
import { BikeHoldsModule } from '../bike-holds/bike-holds.module';
import { FriendsModule } from '../friends/friends.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { ClassSlotsController } from './class-slots.controller';
import { ClassSlotsService } from './class-slots.service';

@Module({
  imports: [
    ReservationsModule,
    WaitlistModule,
    FriendsModule,
    BikeHoldsModule,
  ],
  controllers: [ClassSlotsController],
  providers: [ClassSlotsService],
  exports: [ClassSlotsService],
})
export class ClassSlotsModule {}
