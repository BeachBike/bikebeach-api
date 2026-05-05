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
import { BikesService } from './bikes.service';
import { CreateBikeDto } from './dto/create-bike.dto';
import { UpdateBikeDto } from './dto/update-bike.dto';

@Controller('bikes')
export class BikesController {
  constructor(private readonly bikes: BikesService) {}

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateBikeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.bikes.create(dto, user);
  }

  @Public()
  @Get()
  list(
    @Query('unitId') unitId: string,
    @Query('includeAll') includeAll?: string,
  ) {
    if (!unitId) {
      throw new BadRequestException('unitId é obrigatório');
    }
    return this.bikes.findByUnit(unitId, includeAll === 'true');
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bikes.findOne(id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBikeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bikes.update(id, dto, user);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.bikes.deactivate(id, user);
  }
}
