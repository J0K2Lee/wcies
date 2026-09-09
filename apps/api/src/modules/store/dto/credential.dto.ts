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

  @ApiProperty({ nullable: true, format: 'date-time' })
  lastValidatedAt!: Date | null;

  @ApiProperty({
    nullable: true,
    enum: ['VALID', 'INVALID', 'ERROR'],
    description: 'VALID=已连接 INVALID=认证失败 NULL=未验证',
  })
  lastValidationStatus!: string | null;

  @ApiProperty({ nullable: true, type: String, description: '最近一次验证失败原因（已脱敏）' })
  lastValidationError!: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

/** Result of a credential validation run (Sprint 5 §32; no secret material). */
export class CredentialValidateResultDto {
  @ApiProperty() credentialId!: string;
  @ApiProperty() storeId!: string;
  @ApiProperty({ enum: ['VALID', 'INVALID', 'ERROR'] }) validationStatus!: string;
  @ApiProperty({ nullable: true, type: String }) error!: string | null;
  @ApiProperty({ type: Date }) validatedAt!: Date;
}
