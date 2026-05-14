import { Body, Controller, Get, Ip, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreateCardPackDto } from './dto/create-card-pack.dto';
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

  /// Transparent credit-card pack purchase. `@Ip()` returns the end-user's
  /// address (via the `trust proxy` config in main.ts) — we forward it to
  /// Asaas as `remoteIp` for anti-fraud. Raw card data lives in `dto.creditCard`
  /// only for the duration of this request: it's never persisted, and the
  /// Asaas client redacts it from every log path.
  @Post('card-pack')
  createCardPack(
    @Body() dto: CreateCardPackDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.payments.createCardPackCharge(user.id, dto, ip);
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
