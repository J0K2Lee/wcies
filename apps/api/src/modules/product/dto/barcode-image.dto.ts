import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { BARCODE_TYPES } from '../entities/sku-barcode.entity';

export class CreateBarcodeRequestDto {
  @ApiProperty({ example: '6971234567890', maxLength: 255 })
  @IsString()
  @Length(1, 255)
  barcode!: string;

  @ApiProperty({
    enum: BARCODE_TYPES,
    example: 'EAN',
    description: '69码 uses EAN/GTIN (task §29)',
  })
  @IsIn(BARCODE_TYPES)
  barcodeType!: (typeof BARCODE_TYPES)[number];

  @ApiPropertyOptional({
    example: true,
    description: 'First barcode of a SKU becomes primary automatically',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateBarcodeRequestDto {
  @ApiPropertyOptional({ enum: BARCODE_TYPES })
  @IsOptional()
  @IsIn(BARCODE_TYPES)
  barcodeType?: (typeof BARCODE_TYPES)[number];

  @ApiPropertyOptional({ description: 'DB keeps at most one primary per SKU' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class BarcodeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  skuId!: string;

  @ApiProperty({ example: '6971234567890' })
  barcode!: string;

  @ApiProperty({ example: 'EAN' })
  barcodeType!: string;

  @ApiProperty({ example: true })
  isPrimary!: boolean;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

// ---------------------------------------------------------------------------
// SKU images
// ---------------------------------------------------------------------------

export class UpdateSkuImageRequestDto {
  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'DB keeps at most one primary per SKU' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class SkuImageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  skuId!: string;

  @ApiProperty({ example: 0 })
  sortOrder!: number;

  @ApiProperty({ example: true })
  isPrimary!: boolean;

  @ApiProperty({ example: 'image/webp' })
  mimeType!: string;

  @ApiProperty({ example: 12345 })
  fileSize!: number;

  @ApiProperty({ nullable: true })
  width!: number | null;

  @ApiProperty({ nullable: true })
  height!: number | null;

  @ApiProperty({ example: 'https://...', description: 'Short-lived signed URL (private bucket)' })
  url!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class UploadImageMetadataDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  description?: string;
}
