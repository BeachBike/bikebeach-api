import { Module } from '@nestjs/common';
import { HealthGateModule } from '../health-gate/health-gate.module';
import { MyWaitlistsController } from './my-waitlists.controller';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';

@Module({
  imports: [HealthGateModule],
  controllers: [WaitlistController, MyWaitlistsController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
