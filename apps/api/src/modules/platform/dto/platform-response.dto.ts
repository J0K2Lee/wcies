import { ApiProperty } from '@nestjs/swagger';

export class PlatformResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'OZON' })
  code!: string;

  @ApiProperty({ example: 'OZON' })
  name!: string;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
