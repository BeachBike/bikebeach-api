import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

/// Global so every domain module can inject `RealtimeService` without
/// re-importing. The gateway is also a provider but stays internal —
/// callers shouldn't reach for it directly.
///
/// `JwtModule` is registered locally with the same secret/options pattern
/// as AuthModule so we can verify the JWT during the WS handshake without
/// pulling AuthModule (which would create a circular import — AuthModule
/// → AuthService → ... → most of the domain modules already exporting
/// realtime hooks).
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
