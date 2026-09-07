import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './controllers/auth.controller';
import { UserEntity } from './entities/user.entity';
import { AdminGuard } from './guards/admin.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UserRepository } from './repositories/user.repository';
import { AuthService, parseDurationToMs } from './services/auth.service';
import { UserService } from './services/user.service';

const DEFAULT_JWT_TTL_MS = 8 * 3_600_000; // 8h

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
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
  controllers: [AuthController],
  providers: [AuthService, UserService, UserRepository, JwtAuthGuard, AdminGuard],
  exports: [UserService, AdminGuard],
})
export class AuthModule {}
