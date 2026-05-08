import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreatePixPackDto } from './dto/create-pix-pack.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('pix-pack')
  createPixPack(
    @Body() dto: CreatePixPackDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.createPixPackCharge(user.id, dto.packOfferId);
  }

  @Get('me')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.findMine(user.id);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.findOneForUser(id, user.id);
  }
}
