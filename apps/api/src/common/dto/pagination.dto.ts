import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Shared pagination query params (Sprint 1 task §72): backend paging on all
 * main lists, default pageSize 50, supported sizes 20/50/100. Values above
 * 100 are rejected so a client can never force full-table scans.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
}

export const DEFAULT_PAGE_SIZE = 50;

export function offsetOf(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
