import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { ApiOkNoDataEnvelope } from '../../../common/swagger/api-envelope';
import { Public } from '../decorators/public.decorator';
import { AuthenticatedRequest } from '../guards/jwt-auth.guard';
import { EmailChangeRequestDto } from '../dto/request/email-change.request.dto';
import {
  InviteConfirmRequestDto,
  PasswordChangeConfirmRequestDto,
  TokenOnlyRequestDto,
} from '../dto/request/verification.request.dto';
import { AccountService } from '../services/account.service';
import { UserService } from '../services/user.service';
import { UnauthorizedError } from '../errors/auth-errors';
import { UserEntity } from '../entities/user.entity';

/**
 * Self-service account flows (docs/business-rules/users.md). The confirm
 * endpoints are opened from email links on devices that may hold no session,
 * so they are @Public - the single-use token inside is the proof.
 */
@ApiTags('auth')
@Controller('auth')
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly userService: UserService,
  ) {}

  @Public()
  @Post('verify-email/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an invite link: verify email + set initial password' })
  @ApiOkNoDataEnvelope()
  async confirmInvite(
    @Body() dto: InviteConfirmRequestDto,
  ): Promise<{ success: true; data: Record<string, never> }> {
    await this.accountService.confirmInvite(dto.token, dto.newPassword);
    return ok<Record<string, never>>({});
  }

  @Post('password/change/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email a password-reset link to the verified mailbox' })
  @ApiOkNoDataEnvelope()
  async requestPasswordChange(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: Record<string, never> }> {
    await this.accountService.requestPasswordChange(await this.currentUser(request));
    return ok<Record<string, never>>({});
  }

  @Public()
  @Post('password/change/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a password-reset link and set the new password' })
  @ApiOkNoDataEnvelope()
  async confirmPasswordChange(
    @Body() dto: PasswordChangeConfirmRequestDto,
  ): Promise<{ success: true; data: Record<string, never> }> {
    await this.accountService.confirmPasswordChange(dto.token, dto.newPassword);
    return ok<Record<string, never>>({});
  }

  @Post('email/change/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request an email change: link is sent to the NEW mailbox' })
  @ApiOkNoDataEnvelope()
  async requestEmailChange(
    @Body() dto: EmailChangeRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: Record<string, never> }> {
    await this.accountService.requestEmailChange(await this.currentUser(request), dto);
    return ok<Record<string, never>>({});
  }

  @Public()
  @Post('email/change/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an email-change link from the new mailbox' })
  @ApiOkNoDataEnvelope()
  async confirmEmailChange(
    @Body() dto: TokenOnlyRequestDto,
  ): Promise<{ success: true; data: Record<string, never> }> {
    await this.accountService.confirmEmailChange(dto.token);
    return ok<Record<string, never>>({});
  }

  private async currentUser(request: AuthenticatedRequest): Promise<UserEntity> {
    const user = await this.userService.getEntity(request.user?.id ?? '');
    if (user === null) {
      throw new UnauthorizedError();
    }
    return user;
  }
}
