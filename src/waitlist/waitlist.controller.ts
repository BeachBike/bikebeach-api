import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { WaitlistService } from './waitlist.service';

@Controller('class-slots/:slotId/waitlist')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Post()
  join(
    @Param('slotId') slotId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.waitlist.join(slotId, user);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(
    @Param('slotId') slotId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.waitlist.leave(slotId, user);
  }

  @Get()
  list(
    @Param('slotId') slotId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.waitlist.listFor(slotId, user);
  }
}
