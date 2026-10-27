import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

const MIN_HOURS = 0.1;
const MAX_HOURS = 24 * 30;

/** 订单平台事实回读的分阶段阈值（小时）。 */
export class OrderFallbackHoursDto {
  @ApiProperty({ example: 2, description: 'AWAITING_SHIPMENT 阶段的回读间隔（小时）' })
  awaitingShipment!: number;

  @ApiProperty({ example: 12, description: 'IN_TRANSIT 阶段的回读间隔（小时）' })
  inTransit!: number;

  @ApiProperty({ example: 24, description: 'DELIVERED（未终态）的回读间隔（小时）' })
  delivered!: number;
}

export class SystemSettingsDto {
  @ApiProperty({ type: OrderFallbackHoursDto })
  orderFallbackHours!: OrderFallbackHoursDto;
}

export class UpdateOrderFallbackHoursDto {
  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(MIN_HOURS)
  @Max(MAX_HOURS)
  awaitingShipment?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(MIN_HOURS)
  @Max(MAX_HOURS)
  inTransit?: number;

  @ApiPropertyOptional({ example: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(MIN_HOURS)
  @Max(MAX_HOURS)
  delivered?: number;
}

export class UpdateSystemSettingsRequestDto {
  @ApiPropertyOptional({ type: UpdateOrderFallbackHoursDto })
  @IsOptional()
  orderFallbackHours?: UpdateOrderFallbackHoursDto;
}
