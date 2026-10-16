import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/**
 * 平台分配优先级更新（用户指示 2026-10-16，ADR 0022）。
 * 数值小=优先；范围 [0, 1000] 与仓库绑定 priority 的合理区间一致。
 */
export class UpdatePlatformPriorityRequestDto {
  @ApiProperty({
    example: 10,
    description: '平台分配优先级（数值小=优先）',
    minimum: 0,
    maximum: 1000,
  })
  @IsInt()
  @Min(0)
  @Max(1000)
  priority!: number;
}
