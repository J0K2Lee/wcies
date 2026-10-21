import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * 收货单批量收货（用户需求 2026-10-20）。
 *
 * 每张单**独立一个事务**、逐笔调用既有的 `confirm()`：库存入账、超收校验、
 * 采购单已收数量累加、成本更新全部复用单笔规则，不另写一套。单笔失败
 * （超收、仓库缺失、空单、状态不允许等）只记录结果、不拖垮整批；已确认的
 * 单据按幂等重放计为成功，绝不重复入账。
 */
export class PurchaseBatchConfirmRequestDto {
  @ApiProperty({ type: [String], description: '要确认收货的单据 id 列表（最多 200）' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids!: string[];
}

export class PurchaseBatchConfirmItemResultDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true, example: 'PR000001' })
  code!: string | null;
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, example: 'PURCHASE_RECEIPT_EXCEEDS_ORDERED' })
  errorCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) message!: string | null;
  @ApiProperty({
    description: 'true = 该单此前已确认，本次为幂等重放（未重复入账）',
  })
  idempotentReplay!: boolean;
}

export class PurchaseBatchConfirmResultDto {
  @ApiProperty() total!: number;
  @ApiProperty() succeeded!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [PurchaseBatchConfirmItemResultDto] })
  results!: PurchaseBatchConfirmItemResultDto[];
}
