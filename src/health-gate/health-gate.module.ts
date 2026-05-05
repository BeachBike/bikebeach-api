import { Module } from '@nestjs/common';
import { HealthGateController } from './health-gate.controller';
import { HealthGateService } from './health-gate.service';

@Module({
  controllers: [HealthGateController],
  providers: [HealthGateService],
  exports: [HealthGateService],
})
export class HealthGateModule {}
