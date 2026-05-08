import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Role } from '@prisma/client';
import {
  AdminLiveSlotDto,
  AdminService,
  AdminStatsDto,
} from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('stats')
  async getStats(
    @Query('unitId') unitId: string,
    @CurrentUser() user: any,
  ): Promise<AdminStatsDto> {
    // Verify user has access to this unit
    if (user.unitId && user.unitId !== unitId) {
      throw new Error('Unauthorized: unit mismatch');
    }
    return this.adminService.getStats(unitId);
  }

  /// Item 20 — sidebar AO VIVO widget. Returns the most-attended live slot,
  /// tiebroken by unit createdAt asc. `null` when nothing is rolling.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('live-class')
  async getLiveClass(): Promise<AdminLiveSlotDto | null> {
    return this.adminService.getLiveClass();
  }
}
