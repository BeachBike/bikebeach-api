import { Module } from '@nestjs/common';
import { ClassKindsController } from './class-kinds.controller';
import { ClassKindsService } from './class-kinds.service';

@Module({
  controllers: [ClassKindsController],
  providers: [ClassKindsService],
  exports: [ClassKindsService],
})
export class ClassKindsModule {}
