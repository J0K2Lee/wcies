import { ApiProperty } from '@nestjs/swagger';

/** Replenishment suggestion row (Sprint 10 T4; advisory, never a fact). */
export class ReplenishmentSuggestionDto {
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: 'SKU000001001' }) skuCode!: string;
  @ApiProperty({ example: '浴帘 黑色' }) skuName!: string;
  @ApiProperty({ example: 'ACTIVE' }) skuStatus!: string;
  @ApiProperty({ example: '6.000' }) onHandQty!: string;
  @ApiProperty({ example: '2.000' }) reservedQty!: string;
  @ApiProperty({ example: '0.000' }) pickedQty!: string;
  @ApiProperty({ example: '4.000' }) availableQty!: string;
  @ApiProperty({ example: '2.000' }) safetyQty!: string;
  @ApiProperty({ example: '30.000' }) shippedInWindowQty!: string;
  @ApiProperty({ example: '1.000' }) dailyVelocityQty!: string;
  @ApiProperty({ example: '12.000' }) openPoQty!: string;
  @ApiProperty({ example: '16.000' }) suggestedQty!: string;
  @ApiProperty() needsReplenishment!: boolean;
}
