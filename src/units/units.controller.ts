import {
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
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { UnitsService } from './units.service';

@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateUnitDto, @CurrentUser() user: AuthenticatedUser) {
    return this.units.create(dto, user);
  }

  @Public()
  @Get()
  list(@Query('includeInactive') includeInactive?: string) {
    return this.units.findAll(includeInactive === 'true');
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.units.findOne(id);
  }

  /// Public — feeds the home "instrutores" section. Only returns public-safe
  /// fields (no email/role). `?limit=4` default.
  @Public()
  @Get(':id/featured-instructors')
  featuredInstructors(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : 4;
    return this.units.listFeaturedInstructors(id, Number.isFinite(n) ? n : 4);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUnitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.units.update(id, dto, user);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.units.deactivate(id, user);
  }
}
