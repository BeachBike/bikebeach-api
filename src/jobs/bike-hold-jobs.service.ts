import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BikeHoldsService } from '../bike-holds/bike-holds.service';

/// Sweeps expired `BikeHold` rows once a minute. Reads already filter
/// `expiresAt > now`, so a stale hold never *blocks* a seat — but the
/// sweep is what frees it *visually* (it broadcasts `seatMapChanged` per
/// affected slot inside `sweepExpired`) when nobody is actively
/// interacting with that slot. Disabled under NODE_ENV=test so the e2e
/// suite controls hold lifecycle deterministically.
@Injectable()
export class BikeHoldJobsService {
  private readonly logger = new Logger(BikeHoldJobsService.name);

  constructor(private readonly holds: BikeHoldsService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'bike-hold-sweep' })
  async tick(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.JOBS_DISABLED === 'true') return;
    try {
      await this.holds.sweepExpired();
    } catch (err) {
      this.logger.error('bike-hold sweep failed', err);
    }
  }
}
