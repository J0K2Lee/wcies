import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/**
 * Admin status toggle. Note the mapping (docs/business-rules/users.md):
 * re-enabling an UNVERIFIED account restores PENDING_VERIFICATION, not
 * ACTIVE - the invite link remains the only activation path.
 */
export class UpdateUserStatusRequestDto {
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'], example: 'DISABLED' })
  @IsIn(['ACTIVE', 'DISABLED'])
  status!: 'ACTIVE' | 'DISABLED';
}
