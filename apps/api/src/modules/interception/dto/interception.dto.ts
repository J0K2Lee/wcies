import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ORDER_INTERCEPTION_STATUSES } from '../../order/enums/order.constants';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class InterceptionListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() orderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ enum: ORDER_INTERCEPTION_STATUSES })
  @IsOptional()
  @IsIn(ORDER_INTERCEPTION_STATUSES)
  status?: string;
}

export class AssignInterceptionRequestDto {
  @ApiPropertyOptional({ example: '张三', description: '指派员工（默认当前操作人）' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  assigneeName?: string;
}

export class InterceptionScanRequestDto {
  @ApiProperty({ example: '4601234506789', description: 'SKU 条码（后端验证）' })
  @IsString()
  @Length(1, 255)
  barcode!: string;

  @ApiPropertyOptional({ description: 'SN 管理商品必填' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  serialNumber?: string;

  @ApiProperty({ example: 'SZ01-A01-01', description: '目标回库库位条码（后端验证）' })
  @IsString()
  @Length(1, 255)
  binBarcode!: string;
}

export class ReturnToStockRequestDto {
  @ApiPropertyOptional({ description: '覆盖扫码时记录的目标库位' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  binBarcode?: string;
}

export class FailInterceptionRequestDto {
  @ApiPropertyOptional({ example: '在暂存区未找到商品' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class InterceptionListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'ITC00000001' }) interceptionNo!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ example: 'ORD00000001' }) orderNo!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty({ example: 'SZ01' }) warehouseCode!: string;
  @ApiProperty({ example: 'SKU000001' }) skuCode!: string;
  @ApiProperty({ example: '无线键盘' }) skuName!: string;
  @ApiProperty({ enum: ORDER_INTERCEPTION_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: String }) assignedToName!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
}

export class InterceptionDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'ITC00000001' }) interceptionNo!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ example: 'ORD00000001' }) orderNo!: string;
  @ApiProperty() orderErpStatus!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty({ example: 'SZ01' }) warehouseCode!: string;
  @ApiProperty({ enum: ORDER_INTERCEPTION_STATUSES }) status!: string;
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty({ nullable: true, type: String }) assignedToName!: string | null;
  @ApiProperty({ nullable: true, type: Date }) assignedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) scannedAt!: Date | null;
  @ApiProperty({ nullable: true }) targetBinId!: string | null;
  @ApiProperty({ nullable: true }) failedReason!: string | null;
  @ApiProperty({ nullable: true, type: Date }) failedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) returnedToStockAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) closedAt!: Date | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({
    nullable: true,
    description: '需要找回的订单行：SKU/数量/SN/原拣货库位/已打包包裹',
  })
  item!: {
    orderItemId: string;
    skuId: string;
    skuCode: string;
    skuName: string;
    serialTracking: boolean;
    remainingQty: string;
    pickedSerialNumbers: string[];
    pickBins: Array<{ binId: string; binCode: string; pickedQty: string; shippedQty: string }>;
    packedPackages: Array<{
      packageId: string;
      packageNo: string;
      status: string;
      quantity: string;
    }>;
  } | null;
  @ApiProperty({ type: [Object], description: '状态迁移历史' })
  history!: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    action: string;
    operatorName: string;
    details: Record<string, unknown> | null;
    createdAt: Date;
  }>;
}
