import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClassSlotStatus, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ClassSlotsService } from './class-slots.service';
import { BulkCheckInDto } from './dto/bulk-check-in.dto';
import { CancelClassSlotDto } from './dto/cancel-class-slot.dto';
import { CreateClassSlotDto } from './dto/create-class-slot.dto';
import { FriendsAttendingBatchDto } from './dto/friends-attending-batch.dto';
import { UpdateClassSlotDto } from './dto/update-class-slot.dto';

@Controller('class-slots')
export class ClassSlotsController {
  constructor(private readonly slots: ClassSlotsService) {}

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post()
  create(
    @Body() dto: CreateClassSlotDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.slots.create(dto, user);
  }

  @Public()
  @Get()
  list(
    @Query('unitId') unitId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    if (!unitId) {
      throw new BadRequestException('unitId é obrigatório');
    }
    let parsedStatus: ClassSlotStatus | undefined;
    if (status) {
      if (!(status in ClassSlotStatus)) {
        throw new BadRequestException('status inválido');
      }
      parsedStatus = status as ClassSlotStatus;
    }
    return this.slots.list({ unitId, from, to, status: parsedStatus });
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.slots.findOne(id);
  }

  @Public()
  @Get(':id/seat-map')
  seatMap(@Param('id') id: string) {
    return this.slots.seatMap(id);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Get(':id/roster')
  roster(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.slots.roster(id, user);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateClassSlotDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.slots.update(id, dto, user);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelClassSlotDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.slots.cancel(id, dto, user);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post(':id/confirm-start')
  confirmStart(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.slots.confirmStart(id, user);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post(':id/bulk-check-in')
  bulkCheckIn(
    @Param('id') id: string,
    @Body() dto: BulkCheckInDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.slots.bulkCheckIn(id, dto.presentReservationIds, user);
  }

  /// Authenticated overlay: returns which of the caller's friends are on
  /// each of the supplied slots. Batched so the day-picker on /reservar
  /// can issue one call instead of N.
  @Post('friends-attending-batch')
  friendsAttendingBatch(
    @Body() dto: FriendsAttendingBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.slots.friendsAttendingBatch(dto.slotIds, user);
  }
}
