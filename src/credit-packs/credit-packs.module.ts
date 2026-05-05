import { Module } from '@nestjs/common';
import { CreditPacksController } from './credit-packs.controller';
import { CreditPacksService } from './credit-packs.service';

@Module({
  controllers: [CreditPacksController],
  providers: [CreditPacksService],
  exports: [CreditPacksService],
})
export class CreditPacksModule {}
