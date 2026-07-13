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
import { ClassSlotStatus, Role } from '@prisma/client';
import { BikeHoldsService } from '../bike-holds/bike-holds.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ClassSlotsService } from './class-slots.service';
import { AcquireHoldDto } from './dto/acquire-hold.dto';
import { BulkCheckInDto } from './dto/bulk-check-in.dto';
import { CancelClassSlotDto } from './dto/cancel-class-slot.dto';
import { CreateClassSlotDto } from './dto/create-class-slot.dto';
import { FriendsAttendingBatchDto } from './dto/friends-attending-batch.dto';
import { ToggleCheckInDto } from './dto/toggle-check-in.dto';
import { UpdateClassSlotDto } from './dto/update-class-slot.dto';

@Controller('class-slots')
export class ClassSlotsController {
  constructor(
    private readonly slots: ClassSlotsService,
    private readonly holds: BikeHoldsService,
  ) {}

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
    @Query('unitId') unitId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    let parsedStatus: ClassSlotStatus | undefined;
    if (status) {
      if (!(status in ClassSlotStatus)) {
        throw new BadRequestException('status inválido');
      }
      parsedStatus = status as ClassSlotStatus;
    }
    // Empty string from a client that always serializes the param is treated
    // as "no filter" — same effect as omitting the param entirely.
    return this.slots.list({
      unitId: unitId || undefined,
      from,
      to,
      status: parsedStatus,
    });
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

  /// The caller's own current hold on this slot (or null). Used by the FE
  /// to rehydrate the selection + countdown when the user returns to the
  /// flow after leaving without an explicit "voltar".
  @Get(':id/holds/mine')
  myHold(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.holds.myHold(id, user.id);
  }

  /// Acquire (or move) a temporary exclusive hold on a bike while the
  /// user is in the reservation flow. Auth required. 409 if another user
  /// already holds / reserved the seat.
  @Post(':id/holds')
  acquireHold(
    @Param('id') id: string,
    @Body() dto: AcquireHoldDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.holds.acquire(id, dto.bikeId, user.id);
  }

  /// Re-touch the caller's hold to a fresh TTL — called when advancing to
  /// the confirmation step so the full window applies there.
  @Patch(':id/holds')
  refreshHold(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.holds.refresh(id, user.id);
  }

  /// Release the caller's hold (back / leave the flow). Idempotent.
  @Delete(':id/holds')
  @HttpCode(HttpStatus.NO_CONTENT)
  async releaseHold(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.holds.release(id, user.id);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Get(':id/roster')
  roster(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.slots.roster(id, user);
  }

  /// Full PAR-Q + liability of one participant. Authorized to the class's
  /// instructor or an admin (LGPD-sensitive; enforced in the service).
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Get(':id/participants/:userId/health')
  participantHealth(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.slots.participantHealth(id, userId, user);
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

  /// Live tap on the AO VIVO professor screen — flip one reservation
  /// between presente and ausente without resubmitting the whole roster.
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post(':id/toggle-check-in')
  toggleCheckIn(
    @Param('id') id: string,
    @Body() dto: ToggleCheckInDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.slots.toggleCheckIn(id, dto.reservationId, dto.present, user);
  }

  /// Instructor-triggered "finalizar aula". Closes the slot manually so
  /// the professor doesn't depend on the cron.
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post(':id/finalize')
  finalize(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.slots.finalize(id, user);
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
