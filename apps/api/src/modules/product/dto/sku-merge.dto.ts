import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** SKU 合并预览（2026-10-24）：影响面与冲突项。 */
export class SkuMergePreviewResponseDto {
  @ApiProperty({ type: Object })
  source!: { id: string; skuCode: string; nameZh: string; status: string };

  @ApiProperty({ type: Object })
  target!: { id: string; skuCode: string; nameZh: string; status: string };

  @ApiProperty({
    type: Object,
    description: '各模块引用行数（模块/表名 → 行数），如 order_items / purchase_order_items',
  })
  references!: Record<string, number>;

  @ApiProperty({ type: Object, description: '主数据影响面与冲突' })
  product!: {
    platformMappings: number;
    barcodes: number;
    duplicateBarcodes: number;
    images: number;
    bundleAsBundle: number;
    bundleAsComponent: number;
    bundleConflicts: number;
  };

  @ApiProperty({ type: Object, description: '库存账面影响面' })
  inventory!: {
    balances: number;
    onHandQty: string;
    reservedQty: string;
    pickedQty: string;
    reservations: number;
    serials: number;
    safetyStocks: number;
    transactions: number;
  };
}

export class SkuMergeRequestDto {
  @ApiProperty({ format: 'uuid', description: '保留的目标 SKU' })
  @IsUUID()
  targetSkuId!: string;

  @ApiProperty({ description: '再次输入目标 SKU 编码以确认（危险操作）' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  confirmSkuCode!: string;
}

export class SkuMergeResultResponseDto {
  @ApiProperty({ example: 'SKU000012125', description: '被合并掉（已删除）的源 SKU 编码' })
  mergedSourceSkuCode!: string;

  @ApiProperty({ format: 'uuid' }) targetSkuId!: string;
  @ApiProperty({ example: 'SKU000012101' }) targetSkuCode!: string;

  @ApiProperty({ type: Object, description: '各模块改指行数' })
  references!: Record<string, number>;

  @ApiProperty({ type: Object, description: '库存归并结果（含重算的流水行数）' })
  inventory!: {
    balances: number;
    absorbedOnHand: string;
    absorbedReserved: string;
    absorbedPicked: string;
    reservations: number;
    serials: number;
    safetyStocks: number;
    transactions: number;
    replayedTransactions: number;
  };

  @ApiProperty() barcodesMoved!: number;
  @ApiProperty() barcodesDropped!: number;
  @ApiProperty() imagesMoved!: number;
}

export class SkuMergePreviewQueryDto {
  @ApiProperty({ format: 'uuid', description: '保留的目标 SKU' })
  @IsUUID()
  targetSkuId!: string;
}
