import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreditPacksService } from './credit-packs.service';
import { AddCoOwnersDto } from './dto/add-co-owners.dto';
import { GrantCreditPackDto } from './dto/grant-credit-pack.dto';
import { TransferCreditPackDto } from './dto/transfer-credit-pack.dto';

@Controller('credit-packs')
export class CreditPacksController {
  constructor(private readonly packs: CreditPacksService) {}

  @Roles(Role.ADMIN)
  @Post('grant')
  grant(@Body() dto: GrantCreditPackDto) {
    return this.packs.grant(dto);
  }

  /// Recent admin gifts (source=ADMIN_GRANT) — the "presentes" history.
  @Roles(Role.ADMIN)
  @Get('grants')
  listGrants(@Query('limit') limit?: string) {
    return this.packs.listGrants(limit ? parseInt(limit, 10) : undefined);
  }

  @Get('me')
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeExpired') includeExpired?: string,
  ) {
    return includeExpired === 'true'
      ? this.packs.findAllForUser(user.id)
      : this.packs.findActiveForUser(user.id);
  }

  /// Transfer N credits to a friend. Service enforces:
  /// - caller is the pack owner (not co-owner)
  /// - pack's `isTransferable` is true
  /// - accepted friendship between caller and `toUserId`
  /// - count <= remainingCredits
  /// Returns the freshly-created pack on the friend's side.
  @Post(':id/transfer')
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferCreditPackDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.packs.transferToFriend(id, user.id, dto.toUserId, dto.count);
  }

  /// Add friends as co-owners. They start consuming from the same pool.
  /// Bounded by `pack.maxSharedUsers`.
  @Post(':id/co-owners')
  addCoOwners(
    @Param('id') id: string,
    @Body() dto: AddCoOwnersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.packs.addCoOwners(id, user.id, dto.friendUserIds);
  }

  @Delete(':id/co-owners/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCoOwner(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.packs.removeCoOwner(id, user.id, userId);
  }
}
