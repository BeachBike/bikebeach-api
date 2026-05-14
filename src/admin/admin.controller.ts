import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { Role } from '@prisma/client';
import {
  AdminFinanceClassDetailDto,
  AdminFinanceReportDto,
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
    @CurrentUser() user: AuthenticatedUser,
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

  /// Financial report (informational). Required `from` / `to` (ISO 8601) —
  /// the frontend always picks the window via the date selector so the
  /// backend has no default to invent. Optional `unitId` scopes the
  /// per-class revenue to one arena; pack sales stay global either way.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('finance')
  async getFinance(
    @Query('from') fromIso: string,
    @Query('to') toIso: string,
    @Query('unitId') unitId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AdminFinanceReportDto> {
    if (!fromIso || !toIso) {
      throw new BadRequestException('from e to (ISO) são obrigatórios');
    }
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from / to inválidos');
    }
    if (from >= to) {
      throw new BadRequestException('from precisa ser anterior a to');
    }
    // Same tenancy check the stats endpoint enforces — admins scoped to a
    // single unit can't peek at another arena's revenue.
    if (unitId && user.unitId && user.unitId !== unitId) {
      throw new BadRequestException('Acesso negado: arena fora do escopo');
    }
    return this.adminService.getFinanceReport({ from, to, unitId });
  }

  /// Drill-down for a single class — every reservation, who came, which
  /// pack the credit came from, and what each seat was worth. Feeds the
  /// "Por aula" sub-tab. Tenancy enforced after the lookup so we can return
  /// 404 vs 403 cleanly.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('finance/class/:slotId')
  async getFinanceClass(
    @Param('slotId') slotId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AdminFinanceClassDetailDto> {
    try {
      const detail = await this.adminService.getClassFinanceDetail(slotId);
      if (user.unitId && user.unitId !== detail.slot.unitId) {
        throw new BadRequestException('Acesso negado: arena fora do escopo');
      }
      return detail;
    } catch (e) {
      if (e instanceof Error && e.message === 'CLASS_NOT_FOUND') {
        throw new NotFoundException('Aula não encontrada');
      }
      throw e;
    }
  }
}
