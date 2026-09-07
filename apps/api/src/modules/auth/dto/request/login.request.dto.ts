import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginRequestDto {
  @ApiProperty({ description: 'Username or email', example: 'admin' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  usernameOrEmail!: string;

  @ApiProperty({ description: 'Plain password (transit only, never stored)' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
