import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkNoDataEnvelope } from '../../../common/swagger/api-envelope';
import { LoginRequestDto } from '../dto/request/login.request.dto';
import { LoginResponseDataDto, UserResponseDto } from '../dto/response/login.response.dto';
import { Public } from '../decorators/public.decorator';
import { UnauthorizedError } from '../errors/auth-errors';
import { AuthenticatedRequest } from '../guards/jwt-auth.guard';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with username/email + password (sets HttpOnly session cookie)' })
  @ApiOkEnvelope(LoginResponseDataDto)
  async login(
    @Body() dto: LoginRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true; data: LoginResponseDataDto }> {
    const user = await this.authService.login(dto, request.ip ?? 'unknown', response);
    return ok<LoginResponseDataDto>({ user });
  }

  @Get('me')
  @ApiOperation({ summary: 'Current authenticated user' })
  @ApiOkEnvelope(UserResponseDto)
  async me(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: UserResponseDto }> {
    const user = await this.userService.findById(request.user?.id ?? '');
    if (user === null) {
      throw new UnauthorizedError();
    }
    return ok<UserResponseDto>(this.userService.toResponse(user));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear the session cookie' })
  @ApiOkNoDataEnvelope()
  async logout(
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true; data: Record<string, never> }> {
    this.authService.logout(response);
    return ok<Record<string, never>>({});
  }
}
