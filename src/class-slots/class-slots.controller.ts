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
import { CancelClassSlotDto } from './dto/cancel-class-slot.dto';
import { CreateClassSlotDto } from './dto/create-class-slot.dto';
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
}
