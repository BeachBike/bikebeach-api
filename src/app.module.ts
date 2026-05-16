import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AsaasModule } from './asaas/asaas.module';
import { AuthModule } from './auth/auth.module';
import { BikesModule } from './bikes/bikes.module';
import { ClassKindsModule } from './class-kinds/class-kinds.module';
import { ClassSlotsModule } from './class-slots/class-slots.module';
import { validateEnv } from './config/env.validation';
import { CreditPacksModule } from './credit-packs/credit-packs.module';
import { FriendsModule } from './friends/friends.module';
import { HealthModule } from './health/health.module';
import { HealthGateModule } from './health-gate/health-gate.module';
import { JobsModule } from './jobs/jobs.module';
import { MailerModule } from './mailer/mailer.module';
import { PackOffersModule } from './pack-offers/pack-offers.module';
import { PaymentsModule } from './payments/payments.module';
import { PlansModule } from './plans/plans.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReservationsModule } from './reservations/reservations.module';
import { StorageModule } from './storage/storage.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { UnitsModule } from './units/units.module';
import { UsersModule } from './users/users.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { WebhooksModule } from './webhooks/webhooks.module';

const schedulerEnabled =
  process.env.NODE_ENV !== 'test' && process.env.JOBS_DISABLED !== 'true';

/// Two throttler buckets. The default protects every endpoint from naive
/// scrapers; the `auth` bucket is much tighter and is referenced by name
/// from sensitive auth handlers (signup, login, forgot-password,
/// reset-password) via `@Throttle({ auth: { limit, ttl } })`. Disabled
/// under NODE_ENV=test so e2e suites don't run into 429s.
const throttlerEnabled = process.env.NODE_ENV !== 'test';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ...(schedulerEnabled ? [ScheduleModule.forRoot()] : []),
    ...(throttlerEnabled
      ? [
          ThrottlerModule.forRoot([
            // 120/min was too tight: a single active SPA user polls the
            // seat-map every 30s and fires several queries per page nav
            // (doubled in dev under React StrictMode), tripping 429s on
            // plain reads. 600/min (10 req/s sustained) still cuts off
            // scrapers/DoS at the edge while leaving normal use headroom.
            { name: 'default', ttl: 60_000, limit: 600 },
            // Brute-force protection: 10 auth attempts / minute / IP.
            // Combined with strong bcrypt rounds + login error uniformity
            // this kills credential stuffing at the edge.
            { name: 'auth', ttl: 60_000, limit: 10 },
          ]),
        ]
      : []),
    PrismaModule,
    MailerModule,
    StorageModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    UnitsModule,
    BikesModule,
    ClassKindsModule,
    ClassSlotsModule,
    PlansModule,
    PackOffersModule,
    HealthGateModule,
    CreditPacksModule,
    WaitlistModule,
    ReservationsModule,
    AsaasModule,
    PaymentsModule,
    SubscriptionsModule,
    WebhooksModule,
    AdminModule,
    HealthModule,
    JobsModule,
    FriendsModule,
  ],
  providers: throttlerEnabled
    ? [{ provide: APP_GUARD, useClass: ThrottlerGuard }]
    : [],
})
export class AppModule {}
