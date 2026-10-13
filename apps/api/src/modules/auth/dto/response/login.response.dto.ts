import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'admin' })
  username!: string;

  @ApiProperty({ example: 'admin@wcies.local', nullable: true })
  email!: string | null;

  @ApiProperty({ example: 'ADMIN' })
  role!: string;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ example: true, description: '邮箱是否已验证' })
  emailVerified!: boolean;

  @ApiProperty({ example: '2026-10-05T08:00:00.000Z' })
  createdAt!: string;
}

export class LoginResponseDataDto {
  @ApiProperty()
  user!: UserResponseDto;
}
