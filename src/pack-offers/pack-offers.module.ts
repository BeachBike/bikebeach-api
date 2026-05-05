import { Module } from '@nestjs/common';
import { PackOffersController } from './pack-offers.controller';
import { PackOffersService } from './pack-offers.service';

@Module({
  controllers: [PackOffersController],
  providers: [PackOffersService],
  exports: [PackOffersService],
})
export class PackOffersModule {}
