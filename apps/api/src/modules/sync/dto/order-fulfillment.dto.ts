import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/** Query of `POST /orders/:id/shipping-label` (2026-09-18 fulfillment flow). */
export class FetchShippingLabelQueryDto {
  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'true = 忽略已存档面单，重新向平台取一次（平台面单接口限流，默认复用本地存档）',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  refresh?: string;
}

/** Response of `POST /orders/:id/prepare-shipment` (获取运单号). */
export class PrepareShipmentResultDto {
  @ApiProperty() orderId!: string;
  @ApiProperty({ example: 'ORD00000001' }) orderNo!: string;
  @ApiProperty({ example: 'OZON' }) platformCode!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '平台运单号；平台在组包后才分配，未返回时为 null',
  })
  trackingNumber!: string | null;
  @ApiProperty({ nullable: true, type: String, description: '组包后的平台订单状态（平台原文）' })
  platformStatus!: string | null;
  @ApiProperty({ description: '平台此前已受理该订单（本次未再写平台）' })
  alreadyPrepared!: boolean;
  @ApiProperty({
    description:
      '平台已受理组包但尚未确认（OZON 异步处理，正常中间态）：运单号暂不可读，稍后再次点击即可收敛',
  })
  assemblyPending!: boolean;
  @ApiProperty({ description: '本次点击是否完成平台组包写（受理中/已组包过则为 false）' })
  platformWritePerformed!: boolean;
}
