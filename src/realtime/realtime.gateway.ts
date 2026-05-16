import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/types/jwt-payload.type';

const SEAT_MAP_ROOM = (slotId: string) => `seat-map:${slotId}`;
const USER_ROOM = (userId: string) => `user:${userId}`;

interface SeatMapJoinBody {
  slotId: string;
}

/// Realtime gateway. Two channels live in the same Socket.IO server:
///
/// 1. **seat-map** — public. Any connected socket can `seat-map:join`/`leave`
///    on a slot id and receive `seat-map:changed` when reservations move on
///    that slot. The payload is intentionally minimal (`{ slotId }`); the
///    client refetches the full seat map via REST. Mirrors the existing
///    `/class-slots/:id/seat-map` endpoint, which is itself public.
///
/// 2. **user channel** — auth-required via JWT in the handshake. Authenticated
///    sockets auto-join `user:<userId>` and receive private events
///    (waitlist promotion, class cancellation that affects them). Anonymous
///    sockets are still allowed (they just don't get user events).
///
/// CORS mirrors the REST CORS allowlist. The Nest IoAdapter is wired in
/// main.ts; if anything needs Redis adapter for multi-instance scale-out
/// it slots in there without touching this file.
@WebSocketGateway({
  cors: { origin: true, credentials: false },
  // Force Socket.IO under the default `/socket.io/` path so the FE client
  // doesn't need a custom path config.
})
@Injectable()
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    // Auth is opportunistic — the seat-map channel is public, so a missing
    // / invalid token just means "anonymous connection, no user channel".
    const raw =
      (socket.handshake.auth?.token as string | undefined) ??
      (typeof socket.handshake.query?.token === 'string'
        ? (socket.handshake.query.token as string)
        : undefined);
    if (raw) {
      try {
        const secret = this.config.getOrThrow<string>('JWT_SECRET');
        const payload = await this.jwt.verifyAsync<JwtPayload>(raw, {
          secret,
        });
        socket.data.userId = payload.sub;
        await socket.join(USER_ROOM(payload.sub));
      } catch {
        // bad/expired token → stay anonymous. No reason to refuse the
        // connection; the user can still use the public seat-map.
        socket.data.userId = null;
      }
    } else {
      socket.data.userId = null;
    }
  }

  handleDisconnect(socket: Socket): void {
    // Socket.IO cleans up room memberships automatically on disconnect;
    // this hook stays so observability/log surface is uniform.
    this.logger.debug(`socket ${socket.id} disconnected`);
  }

  @SubscribeMessage('seat-map:join')
  async onSeatMapJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: SeatMapJoinBody,
  ): Promise<{ ok: true }> {
    if (!body?.slotId || typeof body.slotId !== 'string') {
      return { ok: true }; // ignore malformed payloads silently
    }
    await socket.join(SEAT_MAP_ROOM(body.slotId));
    return { ok: true };
  }

  @SubscribeMessage('seat-map:leave')
  async onSeatMapLeave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: SeatMapJoinBody,
  ): Promise<{ ok: true }> {
    if (!body?.slotId || typeof body.slotId !== 'string') {
      return { ok: true };
    }
    await socket.leave(SEAT_MAP_ROOM(body.slotId));
    return { ok: true };
  }

  /// Broadcast helpers — exposed for RealtimeService.
  emitSeatMapChanged(slotId: string): void {
    if (!this.server) return; // not initialized yet (boot / test)
    this.server.to(SEAT_MAP_ROOM(slotId)).emit('seat-map:changed', { slotId });
  }

  emitToUser(userId: string, event: string, payload?: unknown): void {
    if (!this.server) return;
    this.server.to(USER_ROOM(userId)).emit(event, payload ?? {});
  }
}
