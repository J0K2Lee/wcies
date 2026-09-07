import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject } from 'class-validator';
import { CREDENTIAL_TYPES } from '../constants/store.constants';

export class UpsertCredentialRequestDto {
  @ApiProperty({ enum: CREDENTIAL_TYPES, example: 'MAIN_API' })
  @IsIn(CREDENTIAL_TYPES)
  credentialType!: (typeof CREDENTIAL_TYPES)[number];

  @ApiProperty({
    type: Object,
    description: 'Plain credential payload (e.g. apiKey/clientId); encrypted at rest',
  })
  @IsObject()
  payload!: Record<string, unknown>;
}

/**
 * Credential metadata as returned by the API (task §12): NEVER includes the
 * encrypted payload or any secret material.
 */
export class CredentialResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  storeId!: string;

  @ApiProperty({ example: 'MAIN_API' })
  credentialType!: string;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ example: true, description: 'Encrypted payload present and active' })
  configured!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
