import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreatePackOfferDto } from './dto/create-pack-offer.dto';
import { UpdatePackOfferDto } from './dto/update-pack-offer.dto';
import { PackOffersService } from './pack-offers.service';

@Controller('pack-offers')
export class PackOffersController {
  constructor(private readonly offers: PackOffersService) {}

  /// Public: customer-facing /planos page (only active offers).
  /// `unitId` opcional — sem ele lista pacotes de todas as arenas ativas
  /// (modo "todas as arenas" do seletor global).
  @Public()
  @Get()
  list(@Query('unitId') unitId?: string) {
    return this.offers.listPublic(unitId || undefined);
  }

  /// Admin: includes inactive so admin can edit / re-enable.
  @Roles(Role.ADMIN)
  @Get('admin')
  listAdmin(
    @Query('unitId') unitId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!unitId) {
      throw new BadRequestException('unitId é obrigatório');
    }
    return this.offers.listForAdmin(unitId, user);
  }

  @Roles(Role.ADMIN)
  @Post()
  create(
    @Body() dto: CreatePackOfferDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.offers.create(dto, user);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePackOfferDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.offers.update(id, dto, user);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.offers.remove(id, user);
  }
}
