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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';
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

  /// Marks the dashboard onboarding tour as seen. Called when the user
  /// finishes or skips the tour. Idempotent — second call is a no-op
  /// (the field is already true). 204 No Content keeps the FE lean.
  @Patch('me/onboarding-seen')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markOnboardingSeen(@CurrentUser() user: AuthenticatedUser) {
    await this.users.markOnboardingSeen(user.id);
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

  /// Multipart upload — replaces the staff member's portrait. ADMIN can edit
  /// anyone; INSTRUCTOR can edit only their own (enforced in the service).
  /// Accepts PNG (transparent, after `@imgly/background-removal`) or JPG
  /// (raw photo — admin gets warned about the visual impact). 8MB cap.
  /// Multer maps the `LIMIT_FILE_SIZE` error to HTTP 413.
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post('staff/:id/photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (
          file.mimetype === 'image/png' ||
          file.mimetype === 'image/jpeg'
        ) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Imagem precisa ser PNG ou JPG.'), false);
        }
      },
    }),
  )
  uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Campo "photo" obrigatório');
    }
    return this.users.setPhoto(id, file, user);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Delete('staff/:id/photo')
  @HttpCode(HttpStatus.OK)
  deletePhoto(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.clearPhoto(id, user);
  }
}
