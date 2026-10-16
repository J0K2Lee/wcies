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

  @ApiProperty({
    example: 100,
    description: '平台分配优先级（数值小=优先）；缺货到货后「平台>发货时限」排序用',
  })
  priority!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
