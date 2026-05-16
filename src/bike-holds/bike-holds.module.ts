import { Module } from '@nestjs/common';
import { BikeHoldsService } from './bike-holds.service';

/// Owns the temporary seat-hold lifecycle. Prisma + Realtime are global,
/// so this module only needs to expose the service. Imported by
/// ClassSlotsModule (controller endpoints) and ReservationsModule (the
/// create-path guard + consume-on-reservation).
@Module({
  providers: [BikeHoldsService],
  exports: [BikeHoldsService],
})
export class BikeHoldsModule {}
