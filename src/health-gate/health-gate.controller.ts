import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AcceptLiabilityDto } from './dto/accept-liability.dto';
import { SubmitParqDto } from './dto/submit-parq.dto';
import { HealthGateService } from './health-gate.service';

@Controller()
export class HealthGateController {
  constructor(private readonly healthGate: HealthGateService) {}

  @Get('health-gate/status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.healthGate.getStatus(user.id);
  }

  @Post('liability/accept')
  @HttpCode(HttpStatus.CREATED)
  acceptLiability(
    @Body() dto: AcceptLiabilityDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.healthGate.acceptLiability(user.id, dto.version, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  @Post('parq/submit')
  @HttpCode(HttpStatus.CREATED)
  submitParq(
    @Body() dto: SubmitParqDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.healthGate.submitParq(user.id, dto.version, dto.answers, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  }
}
