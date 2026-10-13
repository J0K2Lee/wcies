import { ApiProperty } from '@nestjs/swagger';
import { IsHexadecimal, IsString, Length, MaxLength, MinLength } from 'class-validator';

/** Raw token straight from the email link's ?token= query parameter. */
export class TokenOnlyRequestDto {
  @ApiProperty({ description: '邮件链接中的 token', example: '64位十六进制字符串' })
  @IsString()
  @IsHexadecimal()
  @Length(64)
  token!: string;
}

/** Invite confirmation: verify the mailbox AND set the initial password. */
export class InviteConfirmRequestDto extends TokenOnlyRequestDto {
  @ApiProperty({ description: '初始登录密码（仅在本次激活时设置）' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

/** Password change confirmation from the reset link. */
export class PasswordChangeConfirmRequestDto extends TokenOnlyRequestDto {
  @ApiProperty({ description: '新登录密码' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
