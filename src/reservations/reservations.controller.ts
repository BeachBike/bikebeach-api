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
import { ChangeBikeDto } from './dto/change-bike.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { SelfNoShowDto } from './dto/self-no-show.dto';
import { ReservationsService } from './reservations.service';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  create(
    @Body() dto: CreateReservationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reservations.create(dto, user);
  }

  @Get('me')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.reservations.findMine(user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reservations.findOne(id, user);
  }

  @Delete(':id')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reservations.cancelByUser(id, user);
  }

  @Patch(':id/bike')
  changeBike(
    @Param('id') id: string,
    @Body() dto: ChangeBikeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reservations.changeBike(id, dto.bikeId, user);
  }

  @Post(':id/checkin')
  checkin(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reservations.checkIn(id, user);
  }

  @Post(':id/self-no-show')
  selfNoShow(
    @Param('id') id: string,
    @Body() dto: SelfNoShowDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reservations.selfNoShow(id, dto.reason, user);
  }
}
