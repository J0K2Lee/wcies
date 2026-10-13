import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { AccountController } from './controllers/account.controller';
import { AuthController } from './controllers/auth.controller';
import { UsersController } from './controllers/users.controller';
import { EmailVerificationTokenEntity } from './entities/email-verification-token.entity';
import { UserEntity } from './entities/user.entity';
import { AdminGuard } from './guards/admin.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { EmailVerificationTokenRepository } from './repositories/email-verification-token.repository';
import { UserRepository } from './repositories/user.repository';
import { AccountService } from './services/account.service';
import { AuthService, parseDurationToMs } from './services/auth.service';
import { EmailVerificationService } from './services/email-verification.service';
import { UserAdminService } from './services/user-admin.service';
import { UserService } from './services/user.service';

const DEFAULT_JWT_TTL_MS = 8 * 3_600_000; // 8h

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, EmailVerificationTokenEntity]),
    OperationLogModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const expiresIn =
          parseDurationToMs(config.get<string>('app.jwtExpiresIn') ?? '') ?? DEFAULT_JWT_TTL_MS;
        return {
          secret: config.getOrThrow<string>('app.jwtSecret'),
          signOptions: { expiresIn: Math.floor(expiresIn / 1000) },
        };
      },
    }),
  ],
  controllers: [AuthController, AccountController, UsersController],
  providers: [
    AuthService,
    UserService,
    UserRepository,
    JwtAuthGuard,
    AdminGuard,
    EmailVerificationService,
    EmailVerificationTokenRepository,
    UserAdminService,
    AccountService,
  ],
  exports: [UserService, AdminGuard],
})
export class AuthModule {}
