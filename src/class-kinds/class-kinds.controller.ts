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
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { ClassKindsService } from './class-kinds.service';
import { CreateClassKindDto } from './dto/create-class-kind.dto';
import { UpdateClassKindDto } from './dto/update-class-kind.dto';

@Controller('class-kinds')
export class ClassKindsController {
  constructor(private readonly kinds: ClassKindsService) {}

  @Get()
  list() {
    return this.kinds.listActive();
  }

  @Roles(Role.ADMIN)
  @Get('admin')
  listAdmin() {
    return this.kinds.listAll();
  }

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateClassKindDto) {
    return this.kinds.create(dto);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateClassKindDto) {
    return this.kinds.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@Param('id') id: string): Promise<void> {
    await this.kinds.deactivate(id);
  }
}
