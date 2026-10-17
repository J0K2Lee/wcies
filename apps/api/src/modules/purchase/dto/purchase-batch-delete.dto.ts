import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * 批量删除采购单 / 收货单（用户指示 2026-10-17）。
 *
 * 语义是**物理删除**，但只允许删除从未产生库存事实的单据：
 * - 采购单：无 `RECEIVED` 收货单且所有明细 `received_quantity = 0`
 *   （其 DRAFT/CANCELLED 收货单随采购单一起删除）；
 * - 收货单：状态为 `DRAFT` / `CANCELLED`（确认入库的 `RECEIVED` 拒绝）。
 *
 * 逐笔独立：单笔失败只记录结果、不拖垮整批（与订单页批量动作同约定）。
 * 删除前写 operation_logs（entityType + 单号 + 原状态），保留审计痕迹。
 */
export class PurchaseBatchDeleteRequestDto {
  @ApiProperty({ type: [String], description: '要删除的单据 id 列表（最多 200）' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids!: string[];
}

export class PurchaseBatchDeleteItemResultDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true, example: 'PO000001' })
  code!: string | null;
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, example: 'PURCHASE_ORDER_INVALID_STATE' })
  errorCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) message!: string | null;
}

export class PurchaseBatchDeleteResultDto {
  @ApiProperty() total!: number;
  @ApiProperty() succeeded!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [PurchaseBatchDeleteItemResultDto] })
  results!: PurchaseBatchDeleteItemResultDto[];
}
