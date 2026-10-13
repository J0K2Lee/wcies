import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { USER_ROLES } from '../../enums/user-role.enum';

/** Lowercase-trim emails so uniqueness is not defeated by case variants. */
export function normalizeEmail({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class CreateUserRequestDto {
  @ApiProperty({ example: 'ops-alice' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username!: string;

  @ApiProperty({ example: 'alice@example.com', description: '必须真实可达：邀请邮件发往该地址' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ enum: USER_ROLES, default: 'OPERATOR' })
  @IsIn(USER_ROLES)
  role!: string;
}
