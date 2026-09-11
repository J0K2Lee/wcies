import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { PICKING_ITEM_STATUSES, PICKING_TASK_STATUSES } from '../enums/picking.constants';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class CreatePickingTaskRequestDto {
  @ApiProperty({ description: '从该订单的 RESERVED 行生成拣货任务（按仓拆分）' })
  @IsUUID()
  orderId!: string;
}

export class PickingScanRequestDto {
  @ApiProperty({ example: '4601234506789', description: 'SKU 条码（USB/蓝牙扫码器=键盘输入）' })
  @IsString()
  @Length(1, 255)
  barcode!: string;

  @ApiPropertyOptional({ description: 'SN 管理商品必填' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  serialNumber?: string;

  @ApiPropertyOptional({ description: '预留：库位条码（第一阶段不强制）' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  binBarcode?: string;

  @ApiPropertyOptional({ description: '显式指定拣货行（同 SKU 多行时）' })
  @IsOptional()
  @IsUUID()
  itemId?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class PickingTaskListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PCK00000001' }) pickingNo!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty({ example: 'SZ01' }) warehouseCode!: string;
  @ApiProperty({ example: '深圳自管仓' }) warehouseName!: string;
  @ApiProperty({ enum: PICKING_TASK_STATUSES }) status!: string;
  @ApiProperty() ordersCount!: number;
  @ApiProperty() itemsTotal!: number;
  @ApiProperty() itemsPicked!: number;
  @ApiProperty({ example: '5.000' }) requiredTotal!: string;
  @ApiProperty({ example: '2.000' }) pickedTotal!: string;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) startedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) completedAt!: Date | null;
}

export class PickingTaskListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ enum: PICKING_TASK_STATUSES })
  @IsOptional()
  @IsIn(PICKING_TASK_STATUSES)
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() orderId?: string;
}

export class PickingBinLineDto {
  @ApiProperty() binId!: string;
  @ApiProperty({ example: 'ZG-01-A01-1' }) binCode!: string;
  @ApiProperty({ example: '2.000' }) quantity!: string;
  @ApiProperty({ example: '0.000' }) pickedQty!: string;
}

export class PickingItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() orderItemId!: string;
  @ApiProperty({ example: 'ORD00000001' }) orderNo!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: 'VK87-BLK' }) skuCode!: string;
  @ApiProperty({ example: 'VK87 MAX V2 黑色' }) skuName!: string;
  @ApiProperty({ nullable: true, type: String, description: '主条码（扫码提示）' })
  primaryBarcode!: string | null;
  @ApiProperty() reservationId!: string;
  @ApiProperty({ example: '2.000' }) requiredQty!: string;
  @ApiProperty({ example: '1.000' }) pickedQty!: string;
  @ApiProperty({ enum: PICKING_ITEM_STATUSES }) status!: string;
  @ApiProperty({ type: [PickingBinLineDto], description: '目标库位分配（多 Bin 分别展示）' })
  binLines!: PickingBinLineDto[];
  @ApiProperty() serialTracking!: boolean;
  @ApiProperty({
    type: [String],
    description: 'SN 管理商品：该预约仍待拣的 SN（提示可扫序列号）',
  })
  pendingSerialNumbers!: string[];
}

export class PickingTaskDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PCK00000001' }) pickingNo!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty({ example: 'SZ01' }) warehouseCode!: string;
  @ApiProperty({ example: '深圳自管仓' }) warehouseName!: string;
  @ApiProperty({ enum: PICKING_TASK_STATUSES }) status!: string;
  @ApiProperty() ordersCount!: number;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) startedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) completedAt!: Date | null;
  @ApiProperty({ type: [PickingItemDto] }) items!: PickingItemDto[];
}

export class PickingScanResultDto {
  @ApiProperty() taskId!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty({ example: '2.000' }) pickedQty!: string;
  @ApiProperty({ example: '2.000' }) requiredQty!: string;
  @ApiProperty({ enum: PICKING_ITEM_STATUSES }) itemStatus!: string;
  @ApiProperty({ enum: PICKING_TASK_STATUSES }) taskStatus!: string;
  @ApiProperty({ nullable: true, type: String, description: '本次扫描的 SN' })
  serialNumber!: string | null;
  @ApiProperty() message!: string;
}

export class CreatePickingTaskResultDto {
  @ApiProperty({ type: [PickingTaskListItemDto] }) tasks!: PickingTaskListItemDto[];
}
