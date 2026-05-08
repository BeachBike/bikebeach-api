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
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateStaffUserDto } from './dto/update-staff-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.findById(user.id);
  }

  /// Self-service update — email / phone / cpf / birthDate. Name lives
  /// on the recepção-side flow.
  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMeDto,
  ) {
    return this.users.updateMe(user.id, dto);
  }

  @Roles(Role.ADMIN)
  @Get('staff')
  listStaff(
    @Query('role') role?: string,
    @Query('unitId') unitId?: string,
  ) {
    let parsedRole: Role | undefined;
    if (role) {
      if (role !== Role.INSTRUCTOR && role !== Role.ADMIN) {
        throw new BadRequestException('role precisa ser INSTRUCTOR ou ADMIN');
      }
      parsedRole = role;
    }
    return this.users.listStaff({ role: parsedRole, unitId });
  }

  @Roles(Role.ADMIN)
  @Post('staff')
  createStaff(@Body() dto: CreateStaffUserDto) {
    return this.users.createStaff(dto);
  }

  @Roles(Role.ADMIN)
  @Patch('staff/:id')
  updateStaff(@Param('id') id: string, @Body() dto: UpdateStaffUserDto) {
    return this.users.updateStaff(id, dto);
  }
}
