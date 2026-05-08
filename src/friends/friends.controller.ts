import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { SendFriendRequestDto } from './dto/send-friend-request.dto';
import { UpdateVisibilityDto } from './dto/update-visibility.dto';
import { FriendsService } from './friends.service';

@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get('my-code')
  myCode(@CurrentUser() user: AuthenticatedUser) {
    return this.friends.getMyCode(user);
  }

  // 2026-05 — `regenerate-code` endpoint removed per item-1. Service
  // method stays for emergency manual rotation via the DB; the public
  // surface no longer offers it because regenerating breaks every
  // outstanding share of the old code.

  @Post('requests')
  sendRequest(
    @Body() dto: SendFriendRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.friends.sendRequest(dto.code, user);
  }

  @Get('requests')
  listRequests(@CurrentUser() user: AuthenticatedUser) {
    return this.friends.listPendingRequests(user);
  }

  @Post('requests/:id/accept')
  accept(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.friends.acceptRequest(id, user);
  }

  @Post('requests/:id/decline')
  decline(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.friends.declineRequest(id, user);
  }

  @Delete('requests/:id')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.friends.cancelOutgoing(id, user);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.friends.listFriends(user);
  }

  @Delete(':friendUserId')
  remove(
    @Param('friendUserId') friendUserId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.friends.removeFriend(friendUserId, user);
  }

  @Patch('visibility')
  updateVisibility(
    @Body() dto: UpdateVisibilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.friends.updateVisibility(
      user,
      dto.hideReservationsFromFriends,
    );
  }
}
