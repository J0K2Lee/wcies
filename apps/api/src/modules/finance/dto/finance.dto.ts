import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  FINANCE_DIRECTIONS,
  FINANCE_PAYOUT_STATUSES,
  FINANCE_TRANSACTION_CATEGORIES,
  PURCHASE_PAYMENT_STATES,
} from '../enums/finance.constants';

const AMOUNT_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;
const asAmountString = ({ value }: { value: unknown }): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Transactions (finance.md §3)
// ---------------------------------------------------------------------------

export class CreateFinanceTransactionRequestDto {
  @ApiProperty({ enum: FINANCE_DIRECTIONS })
  @IsIn(FINANCE_DIRECTIONS)
  direction!: string;

  @ApiProperty({ enum: FINANCE_TRANSACTION_CATEGORIES })
  @IsIn(FINANCE_TRANSACTION_CATEGORIES)
  category!: string;

  @ApiProperty({ example: '107.0000' })
  @Transform(asAmountString)
  @Matches(AMOUNT_PATTERN, { message: '金额格式错误（最多4位小数）' })
  amount!: string;

  @ApiPropertyOptional({ example: 'CNY' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: '业务发生时间，默认当前' })
  @IsOptional()
  @IsDateString()
  occurredAt?: Date;

  @ApiPropertyOptional({ description: '关联店铺' })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({ description: '关联供应商（可空，采购付款亦可空）' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ description: '关联订单（销售收入/退款必填）' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ description: '关联采购单（采购付款必填）' })
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
}

export class FinanceTransactionListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '凭证号 / 订单号 / 采购单号模糊搜索' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ enum: FINANCE_DIRECTIONS })
  @IsOptional()
  @IsIn(FINANCE_DIRECTIONS)
  direction?: string;

  @ApiPropertyOptional({ enum: FINANCE_TRANSACTION_CATEGORIES })
  @IsOptional()
  @IsIn(FINANCE_TRANSACTION_CATEGORIES)
  category?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() storeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() orderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() purchaseOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() payoutId?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  from?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

// ---------------------------------------------------------------------------
// Payouts (finance.md §4)
// ---------------------------------------------------------------------------

export class CreateFinancePayoutRequestDto {
  @ApiProperty() @IsUUID() storeId!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  periodStart!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  periodEnd!: string;
  @ApiProperty({ example: '1284.0000' })
  @Transform(asAmountString)
  @Matches(AMOUNT_PATTERN, { message: '金额格式错误（最多4位小数）' })
  amount!: string;
  @ApiPropertyOptional({ example: 'CNY' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
}

export class FinancePayoutListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '回款单号模糊搜索' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() storeId?: string;
  @ApiPropertyOptional({ enum: FINANCE_PAYOUT_STATUSES })
  @IsOptional()
  @IsIn(FINANCE_PAYOUT_STATUSES)
  status?: string;
}

// ---------------------------------------------------------------------------
// Settlements (finance.md §5)
// ---------------------------------------------------------------------------

export class GenerateOrderSettlementRequestDto {
  @ApiProperty() @IsUUID() orderId!: string;
}

export class UpdateOrderSettlementFeesRequestDto {
  @ApiPropertyOptional({ example: '25.0000', description: '物流费（重算毛利）' })
  @IsOptional()
  @Transform(asAmountString)
  @Matches(AMOUNT_PATTERN, { message: '金额格式错误（最多4位小数）' })
  shippingFee?: string;

  @ApiPropertyOptional({ example: '0.0000', description: '其他费用（重算毛利）' })
  @IsOptional()
  @Transform(asAmountString)
  @Matches(AMOUNT_PATTERN, { message: '金额格式错误（最多4位小数）' })
  otherFee?: string;
}

export class OrderSettlementListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '订单号 / 平台订单号模糊搜索' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() storeId?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', description: '结算生成时间 ≥' })
  @IsOptional()
  @IsDateString()
  from?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', description: '结算生成时间 <' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

// ---------------------------------------------------------------------------
// Payables / summary (finance.md §6/§7)
// ---------------------------------------------------------------------------

export class PayablesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '采购单号 / 供应商模糊搜索' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ enum: PURCHASE_PAYMENT_STATES })
  @IsOptional()
  @IsIn(PURCHASE_PAYMENT_STATES)
  paymentState?: string;
}

export class FinanceSummaryQueryDto {
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

// ---------------------------------------------------------------------------
// Response DTOs (contract-guard requirement: every envelope resolves to a
// real schema; the flat shapes match what the services return).
// ---------------------------------------------------------------------------

export class FinanceTransactionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'FV000001' }) voucherNo!: string;
  @ApiProperty({ enum: FINANCE_DIRECTIONS }) direction!: string;
  @ApiProperty({ enum: FINANCE_TRANSACTION_CATEGORIES }) category!: string;
  @ApiProperty({ example: '107.0000' }) amount!: string;
  @ApiProperty({ example: 'CNY' }) currency!: string;
  @ApiProperty({ type: Date }) occurredAt!: Date;
  @ApiProperty({ nullable: true, type: String }) storeId!: string | null;
  @ApiProperty({ nullable: true, type: String }) supplierId!: string | null;
  @ApiProperty({ nullable: true, type: String }) orderId!: string | null;
  @ApiProperty({ nullable: true, type: String }) purchaseOrderId!: string | null;
  @ApiProperty({ nullable: true, type: String }) payoutId!: string | null;
  @ApiProperty({ nullable: true, type: String }) reversedByVoucherNo!: string | null;
  @ApiProperty({ nullable: true, type: String }) remark!: string | null;
  @ApiProperty({ nullable: true, type: String }) createdBy!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
  @ApiPropertyOptional({ nullable: true, type: String }) storeName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) supplierName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) orderNo!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) purchaseOrderNo!: string | null;
}

export class FinancePayoutDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PY000001' }) payoutNo!: string;
  @ApiProperty() storeId!: string;
  @ApiProperty({ type: Date }) periodStart!: Date;
  @ApiProperty({ type: Date }) periodEnd!: Date;
  @ApiProperty({ example: '1284.0000' }) amount!: string;
  @ApiProperty({ example: 'CNY' }) currency!: string;
  @ApiProperty({ enum: FINANCE_PAYOUT_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: String }) remark!: string | null;
  @ApiProperty({ nullable: true, type: String }) createdBy!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
  @ApiPropertyOptional({ nullable: true, type: String }) storeName!: string | null;
}

export class FinancePayoutPreviewDto {
  @ApiProperty({ type: FinancePayoutDto }) payout!: FinancePayoutDto;
  @ApiProperty({ example: '1284.0000' }) settledRevenue!: string;
  @ApiProperty({ example: 12 }) settledOrderCount!: number;
  @ApiProperty({ example: '0.0000' }) difference!: string;
}

export class OrderSettlementItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() settlementId!: string;
  @ApiProperty() orderItemId!: string;
  @ApiProperty({ nullable: true, type: String }) skuId!: string | null;
  @ApiProperty({ example: '2.000' }) quantity!: string;
  @ApiProperty({ nullable: true, type: String, example: '107.0000' }) unitPrice!: string | null;
  @ApiProperty({ example: '214.0000' }) revenue!: string;
  @ApiProperty({ nullable: true, type: String, example: '80.0000' }) unitCost!: string | null;
  @ApiProperty({ example: '160.0000' }) cost!: string;
}

export class OrderSettlementDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ nullable: true, type: String, example: 'CNY' }) currency!: string | null;
  @ApiProperty({ example: '214.0000' }) revenueTotal!: string;
  @ApiProperty({ example: '160.0000' }) productCostTotal!: string;
  @ApiProperty({ example: '25.0000' }) shippingFee!: string;
  @ApiProperty({ example: '0.0000' }) otherFee!: string;
  @ApiProperty({ nullable: true, type: String, example: '29.0000' }) profit!: string | null;
  @ApiProperty() hasMissingPrice!: boolean;
  @ApiProperty() hasMissingCost!: boolean;
  @ApiProperty({ nullable: true, type: String }) generatedBy!: string | null;
  @ApiProperty({ type: Date }) generatedAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
  @ApiPropertyOptional({ example: 'ORD00000001' }) orderNo!: string;
  @ApiPropertyOptional({ example: 'OZON-123' }) platformOrderId!: string;
  @ApiPropertyOptional() storeId!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) storeName!: string | null;
  @ApiPropertyOptional({ type: Date }) orderedAt!: Date;
}

export class OrderSettlementDetailDto extends OrderSettlementDto {
  @ApiProperty({ type: [OrderSettlementItemDto] }) items!: OrderSettlementItemDto[];
}

export class SettlementGenerateMissingResultDto {
  @ApiProperty({ example: 3 }) generated!: number;
  @ApiProperty({ example: 0 }) skipped!: number;
  @ApiProperty({ type: [String] }) settlementIds!: string[];
}

export class PayableRowDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PO000001' }) poNo!: string;
  @ApiProperty({ nullable: true, type: String }) supplierId!: string | null;
  @ApiProperty({ nullable: true, type: String }) supplierName!: string | null;
  @ApiProperty({ example: 'RECEIVED' }) status!: string;
  @ApiProperty({ type: Date }) orderedAt!: Date;
  @ApiProperty({ example: '300.0000' }) payableAmount!: string;
  @ApiProperty({ example: '100.0000' }) paidAmount!: string;
  @ApiProperty({ example: '200.0000' }) unpaidAmount!: string;
  @ApiProperty({ enum: PURCHASE_PAYMENT_STATES }) paymentState!: string;
  @ApiProperty() hasUnpricedLines!: boolean;
}

export class FinanceSummaryResponseDto {
  @ApiProperty({ type: Object, nullable: true })
  range!: { from: string | null; to: string | null };
  @ApiProperty({ example: '150.0000' }) incomeTotal!: string;
  @ApiProperty({ example: '300.0000' }) expenseTotal!: string;
  @ApiProperty({ example: '-150.0000' }) netTotal!: string;
  @ApiProperty({ example: '214.0000' }) settledRevenue!: string;
  @ApiProperty({ example: '185.0000' }) settledCost!: string;
  @ApiProperty({ example: '29.0000' }) settledProfit!: string;
  @ApiProperty({ example: '200.0000' }) unpaidPurchaseTotal!: string;
  @ApiProperty({ example: '150.0000' }) confirmedPayoutTotal!: string;
}
