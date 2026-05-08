import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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
import { PackOffersModule } from './pack-offers/pack-offers.module';
import { PaymentsModule } from './payments/payments.module';
import { PlansModule } from './plans/plans.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReservationsModule } from './reservations/reservations.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { UnitsModule } from './units/units.module';
import { UsersModule } from './users/users.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
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
})
export class AppModule {}
