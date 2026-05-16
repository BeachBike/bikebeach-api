import { Injectable } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/// Thin façade other modules inject. Keeps the gateway off the import path
/// of every domain service — they only depend on the small surface here.
/// Every method is fire-and-forget and never throws (a Socket.IO server
/// in a degraded state must never break a domain operation).
@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  /// Notify everyone currently watching a slot's seat-map that the
  /// occupied set may have changed. Receivers refetch the seat-map via
  /// REST. Call AFTER the DB transaction commits — otherwise consumers
  /// might race and see stale state.
  seatMapChanged(slotId: string): void {
    try {
      this.gateway.emitSeatMapChanged(slotId);
    } catch {
      /* never propagate */
    }
  }

  /// Push a private event to one user's connected sockets. `event` is the
  /// channel name the FE listens for; payload is JSON-serializable.
  /// Used for waitlist promotion + class-cancellation notices.
  notifyUser(userId: string, event: UserEvent, payload?: unknown): void {
    try {
      this.gateway.emitToUser(userId, event, payload);
    } catch {
      /* never propagate */
    }
  }
}

/// Whitelist of user-channel event names. Centralized so FE + BE share
/// the same alphabet without runtime collisions.
export type UserEvent =
  | 'waitlist:promoted'
  | 'class:cancelled'
  | 'reservation:cancelled-by-studio';
