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
}

export class LoginResponseDataDto {
  @ApiProperty()
  user!: UserResponseDto;
}
