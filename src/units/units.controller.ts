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
  /// fields (no email/role). `?limit=4` default. The literal `id=all` is a
  /// reserved sentinel: returns top-N across every active arena (drives the
  /// "todas as arenas" option of the global arena picker on the home).
  @Public()
  @Get(':id/featured-instructors')
  featuredInstructors(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : 4;
    const safeN = Number.isFinite(n) ? n : 4;
    if (id === 'all') {
      return this.units.listFeaturedInstructorsAcrossArenas(safeN);
    }
    return this.units.listFeaturedInstructors(id, safeN);
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
