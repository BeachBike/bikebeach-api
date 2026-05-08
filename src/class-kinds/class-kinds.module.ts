import { Module } from '@nestjs/common';
import { ClassSlotsModule } from '../class-slots/class-slots.module';
import { ClassKindsController } from './class-kinds.controller';
import { ClassKindsService } from './class-kinds.service';

@Module({
  imports: [ClassSlotsModule],
  controllers: [ClassKindsController],
  providers: [ClassKindsService],
  exports: [ClassKindsService],
})
export class ClassKindsModule {}
