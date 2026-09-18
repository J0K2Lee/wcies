import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  PACKAGE_STATUSES,
  SHIPMENT_STATUSES,
  SHIPPING_LABEL_TYPES,
  SHIPMENT_ITEM_STATUSES,
  VOID_SOURCE_TYPES,
} from '../enums/shipment.constants';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class CreateShipmentRequestDto {
  @ApiProperty({
    description: '从该订单的 PICKED 行创建发货单（按仓拆分，1 Shipment = 1 Warehouse）',
  })
  @IsUUID()
  orderId!: string;
}

export class ShipmentListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() orderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ enum: SHIPMENT_STATUSES })
  @IsOptional()
  @IsIn(SHIPMENT_STATUSES)
  status?: string;
  @ApiPropertyOptional({ description: '物流单号模糊搜索' })
  @IsOptional()
  @IsString()
  trackingNumber?: string;
}

export class UpdateShipmentTrackingRequestDto {
  @ApiPropertyOptional({
    example: 'TRK123456789',
    description: '人工录入物流单号（未来 Adapter 自动填入）',
  })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  trackingNumber?: string;

  @ApiPropertyOptional({ example: 'CDEK' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  carrierCode?: string;

  @ApiPropertyOptional({ example: 'EXPRESS' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  shippingMethod?: string;
}

export class ShipShipmentRequestDto {
  @ApiPropertyOptional({ description: '幂等键：重复提交同一键不会重复扣减库存' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: '出库时顺带录入物流信息' })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateShipmentTrackingRequestDto)
  tracking?: UpdateShipmentTrackingRequestDto;
}

export class PackageDimensionsDto {
  @ApiPropertyOptional({ example: '1.250' })
  @IsOptional()
  @IsString()
  weightKg?: string;

  @ApiPropertyOptional({ example: '30.00' })
  @IsOptional()
  @IsString()
  lengthCm?: string;

  @ApiPropertyOptional({ example: '20.00' })
  @IsOptional()
  @IsString()
  widthCm?: string;

  @ApiPropertyOptional({ example: '10.00' })
  @IsOptional()
  @IsString()
  heightCm?: string;
}

export class SealPackageRequestDto {
  @ApiPropertyOptional({ description: '封箱时录入重量/尺寸' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PackageDimensionsDto)
  dimensions?: PackageDimensionsDto;
}

export class PackingScanRequestDto {
  @ApiProperty({ example: '4601234506789', description: 'SKU 条码（扫码器=键盘输入，每次 1 件）' })
  @IsString()
  @Length(1, 255)
  barcode!: string;

  @ApiPropertyOptional({ description: 'SN 管理商品必填' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  serialNumber?: string;
}

export class PackageListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() shipmentId?: string;
  @ApiPropertyOptional({ enum: PACKAGE_STATUSES })
  @IsOptional()
  @IsIn(PACKAGE_STATUSES)
  status?: string;
}

export class UploadLabelRequestDto {
  @ApiPropertyOptional({ enum: SHIPPING_LABEL_TYPES, default: 'SHIPPING' })
  @IsOptional()
  @IsIn(SHIPPING_LABEL_TYPES)
  labelType?: string;

  @ApiPropertyOptional({ description: '关联包裹（可空=整单面单）' })
  @IsOptional()
  @IsUUID()
  packageId?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class ShipmentItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderItemId!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: 'SKU000001' }) skuCode!: string;
  @ApiProperty({ example: '无线键盘' }) skuName!: string;
  @ApiProperty() reservationId!: string;
  @ApiProperty({ example: '2.000', description: '本发货单应发数量（PICKED 快照）' })
  quantity!: string;
  @ApiProperty({ example: '2.000', description: '已打包数量（全部包裹合计）' }) packedQty!: string;
  @ApiProperty({ description: 'SN 管理商品' }) serialTracking!: boolean;
  @ApiProperty({ type: [String], description: '该行需要打包的 SN（SN 商品）' })
  serialNumbers!: string[];
  /** ACTIVE = 仍是发货单有效组成部分（不代表未发货）；VOIDED = 已作废的审计历史。 */
  @ApiProperty({ enum: SHIPMENT_ITEM_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: Date }) voidedAt!: Date | null;
  @ApiProperty({ nullable: true, description: '作废操作人 users.id' }) voidedBy!: string | null;
  @ApiProperty({ nullable: true, description: '作废时操作人显示名快照' }) voidedByName!:
    string | null;
  @ApiProperty({ nullable: true }) voidReason!: string | null;
  @ApiProperty({ nullable: true, enum: VOID_SOURCE_TYPES }) voidSourceType!: string | null;
  @ApiProperty({ nullable: true, description: '多态来源 ID，如 order_interceptions.id' })
  voidSourceId!: string | null;
}

export class PackageItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderItemId!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: 'SKU000001' }) skuCode!: string;
  @ApiProperty({ example: '无线键盘' }) skuName!: string;
  @ApiProperty({ example: '2.000' }) quantity!: string;
  @ApiProperty({ type: [String] }) serialNumbers!: string[];
}

export class PackageListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PKG00000001' }) packageNo!: string;
  @ApiProperty() shipmentId!: string;
  @ApiProperty({ enum: PACKAGE_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: Date }) sealedAt!: Date | null;
  @ApiProperty({ type: [PackageItemDto] }) items!: PackageItemDto[];
  @ApiProperty({ example: '3.000', description: '包裹内件数合计' }) totalQty!: string;
  @ApiProperty({ nullable: true, type: Date }) createdAt!: Date;
}

export class ShipmentDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'SHP00000001' }) shipmentNo!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ example: 'ORD00000001' }) orderNo!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty({ example: 'SZ01' }) warehouseCode!: string;
  @ApiProperty({ example: '深圳自管仓' }) warehouseName!: string;
  @ApiProperty({ enum: SHIPMENT_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, example: 'TRK123' }) trackingNumber!: string | null;
  @ApiProperty({ nullable: true, example: 'CDEK' }) carrierCode!: string | null;
  @ApiProperty({ nullable: true, example: 'EXPRESS' }) shippingMethod!: string | null;
  @ApiProperty({ nullable: true, type: Date }) shippedAt!: Date | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: [ShipmentItemDto], description: '待发商品快照与打包进度（仅 ACTIVE）' })
  items!: ShipmentItemDto[];
  @ApiProperty({
    type: [ShipmentItemDto],
    description: '已作废 / 历史记录（VOIDED，永久保留，不参与任何计算）',
  })
  voidedItems!: ShipmentItemDto[];
  @ApiProperty({ type: [PackageListItemDto] }) packages!: PackageListItemDto[];
  @ApiProperty({ type: [Object], description: '面单元数据（含签名查看 URL）' })
  labels!: Array<{
    id: string;
    packageId: string | null;
    labelType: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    source: string;
    createdAt: Date;
    signedUrl: string;
  }>;
}

export class ShipmentListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'SHP00000001' }) shipmentNo!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ example: 'ORD00000001' }) orderNo!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty({ example: 'SZ01' }) warehouseCode!: string;
  @ApiProperty({ example: '深圳自管仓' }) warehouseName!: string;
  @ApiProperty({ enum: SHIPMENT_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, example: 'TRK123' }) trackingNumber!: string | null;
  @ApiProperty() packagesCount!: number;
  @ApiProperty() sealedPackagesCount!: number;
  @ApiProperty() itemsTotal!: number;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) shippedAt!: Date | null;
}

export class CreateShipmentResultDto {
  @ApiProperty({ type: [ShipmentListItemDto] }) shipments!: ShipmentListItemDto[];
}

export class CreatePackageResultDto {
  @ApiProperty() packageId!: string;
  @ApiProperty({ example: 'PKG00000001' }) packageNo!: string;
  @ApiProperty({ enum: SHIPMENT_STATUSES }) shipmentStatus!: string;
}

export class PackageWorkbenchItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderItemId!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: 'SKU000001' }) skuCode!: string;
  @ApiProperty({ example: '无线键盘' }) skuName!: string;
  @ApiProperty({ example: '2.000' }) quantity!: string;
  @ApiProperty({ type: [String] }) serialNumbers!: string[];
}

export class PackageWorkbenchDemandDto {
  @ApiProperty() orderItemId!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: 'SKU000001' }) skuCode!: string;
  @ApiProperty({ example: '无线键盘' }) skuName!: string;
  @ApiProperty({ nullable: true, type: String }) primaryBarcode!: string | null;
  @ApiProperty({ example: '2.000' }) requiredQty!: string;
  @ApiProperty({ example: '1.000' }) packedQty!: string;
  @ApiProperty({ description: 'SN 管理商品' }) serialTracking!: boolean;
  @ApiProperty({ type: [String], description: 'SN 商品尚未装箱的 SN' })
  pendingSerialNumbers!: string[];
}

export class PackageWorkbenchDto {
  @ApiProperty({
    type: Object,
    description: '包裹头（id/packageNo/shipmentId/status/sealedAt/createdAt）',
  })
  package!: {
    id: string;
    packageNo: string;
    shipmentId: string;
    status: string;
    sealedAt: Date | null;
    createdAt: Date;
  };
  @ApiProperty({ example: 'SHP00000001' }) shipmentNo!: string;
  @ApiProperty({ enum: SHIPMENT_STATUSES }) shipmentStatus!: string;
  @ApiProperty({ type: [PackageWorkbenchItemDto], description: '已装明细' })
  items!: PackageWorkbenchItemDto[];
  @ApiProperty({ type: [PackageWorkbenchDemandDto], description: '待装商品与扫码进度' })
  demand!: PackageWorkbenchDemandDto[];
}

export class PackingScanResultDto {
  @ApiProperty() packageId!: string;
  @ApiProperty() orderItemId!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: 'SKU000001' }) skuCode!: string;
  @ApiProperty({ example: '1.000' }) packedQty!: string;
  @ApiProperty({ example: '2.000', description: '该行应打包总数' }) requiredQty!: string;
  @ApiProperty({ nullable: true, type: String }) serialNumber!: string | null;
  @ApiProperty() message!: string;
}

export class SealPackageResultDto {
  @ApiProperty() packageId!: string;
  @ApiProperty({ enum: PACKAGE_STATUSES }) packageStatus!: string;
  @ApiProperty() shipmentId!: string;
  @ApiProperty({ enum: SHIPMENT_STATUSES }) shipmentStatus!: string;
  @ApiProperty({ example: '2.000' }) totalQty!: string;
}

export class ShipShipmentResultDto {
  @ApiProperty() shipmentId!: string;
  @ApiProperty({ enum: SHIPMENT_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: Date }) shippedAt!: Date | null;
  @ApiProperty({ description: '重复出库时为 true（未再次扣减库存）' }) alreadyShipped!: boolean;
  @ApiProperty({ example: 'ORD00000001' }) orderNo!: string;
  @ApiProperty({ description: '出库后订单 ERP 状态' }) orderErpStatus!: string;
  @ApiProperty({ type: [String], description: '本次出库产生的库存事件号' }) eventNos!: string[];
}

export class ShippingLabelDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '发货单级面单（手工上传）有值；平台面单在出库前先挂订单，此时为 null',
  })
  shipmentId!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '订单级（平台 API）面单所属订单；发货单级面单为 null',
  })
  orderId!: string | null;
  @ApiProperty({ nullable: true }) packageId!: string | null;
  @ApiProperty({ enum: SHIPPING_LABEL_TYPES }) labelType!: string;
  @ApiProperty({ example: '面单.pdf' }) fileName!: string;
  @ApiProperty({ example: 'application/pdf' }) mimeType!: string;
  @ApiProperty() fileSize!: number;
  @ApiProperty({ example: 'MANUAL_UPLOAD' }) source!: string;
  @ApiProperty({ nullable: true, type: String }) externalLabelId!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ description: '短期有效的私有文件签名 URL（浏览器打开/打印）' }) signedUrl!: string;
}
