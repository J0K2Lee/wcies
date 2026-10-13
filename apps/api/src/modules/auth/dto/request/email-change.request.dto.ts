import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail } from './create-user.request.dto';

export class EmailChangeRequestDto {
  @ApiProperty({ example: 'new-mailbox@example.com', description: '新邮箱（验证链接发往该地址）' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  newEmail!: string;

  @ApiProperty({ description: '当前登录密码（账号控制权证明）' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
