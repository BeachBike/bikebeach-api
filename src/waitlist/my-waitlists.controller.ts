import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { WaitlistService } from './waitlist.service';

/// Per-user listing of pending waitlist entries. Drives the
/// "você está na fila" badges on the dashboard and the step-aula card.
/// Kept as a separate controller from `WaitlistController` so the per-slot
/// path (`/class-slots/:slotId/waitlist`) doesn't have to grow a special
/// `:slotId = me` overload.
@Controller('me/waitlists')
export class MyWaitlistsController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.waitlist.listMine(user);
  }
}
