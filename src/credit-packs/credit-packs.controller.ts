import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreditPacksService } from './credit-packs.service';
import { GrantCreditPackDto } from './dto/grant-credit-pack.dto';

@Controller('credit-packs')
export class CreditPacksController {
  constructor(private readonly packs: CreditPacksService) {}

  @Roles(Role.ADMIN)
  @Post('grant')
  grant(@Body() dto: GrantCreditPackDto) {
    return this.packs.grant(dto);
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
}
