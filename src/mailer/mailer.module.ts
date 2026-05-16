import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { ResendClient } from './resend.client';

/// Global so every domain module can inject `MailerService` without
/// re-importing. Templates live next door but are not exported — they're
/// rendered through the service so logging/audit/sorteio stay in one place.
@Global()
@Module({
  providers: [MailerService, ResendClient],
  exports: [MailerService],
})
export class MailerModule {}
