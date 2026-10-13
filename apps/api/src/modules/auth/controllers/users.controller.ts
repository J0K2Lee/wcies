import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ApiOkArrayEnvelope, ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { AdminGuard } from '../guards/admin.guard';
import { CreateUserRequestDto } from '../dto/request/create-user.request.dto';
import { UpdateUserStatusRequestDto } from '../dto/request/update-user-status.request.dto';
import { CreateUserResponseDto } from '../dto/response/create-user.response.dto';
import { UserResponseDto } from '../dto/response/login.response.dto';
import { AuthenticatedRequest } from '../guards/jwt-auth.guard';
import { UserAdminService } from '../services/user-admin.service';
import { Req } from '@nestjs/common';

/** User management - admin only (docs/business-rules/users.md). */
@ApiTags('users')
@UseGuards(AdminGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly userAdminService: UserAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List all users (admin)' })
  @ApiOkArrayEnvelope(UserResponseDto)
  async list(): Promise<{ success: true; data: UserResponseDto[] }> {
    return ok(await this.userAdminService.list());
  }

  @Post()
  @ApiOperation({
    summary: 'Create a user (admin) and send the email verification invite',
  })
  @ApiOkEnvelope(CreateUserResponseDto)
  async create(
    @Body() dto: CreateUserRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: CreateUserResponseDto }> {
    return ok(await this.userAdminService.create(dto, operator));
  }

  @Post(':id/resend-invite')
  @ApiOperation({ summary: 'Re-send the verification invite (unverified accounts only)' })
  @ApiOkEnvelope(UserResponseDto)
  async resendInvite(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: UserResponseDto }> {
    return ok(await this.userAdminService.resendInvite(id, operator));
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Enable / disable a user (admin)' })
  @ApiOkEnvelope(UserResponseDto)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusRequestDto,
    @Req() request: AuthenticatedRequest,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: UserResponseDto }> {
    return ok(
      await this.userAdminService.setStatus(request.user?.id ?? '', id, dto.status, operator),
    );
  }
}
