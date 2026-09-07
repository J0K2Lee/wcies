import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import {
  CreateSkuRequestDto,
  SkuListItemDto,
  SkuListQueryDto,
  SkuResponseDto,
  UpdateSkuRequestDto,
} from '../dto/product-sku.dto';
import {
  BarcodeResponseDto,
  CreateBarcodeRequestDto,
  SkuImageResponseDto,
  UpdateBarcodeRequestDto,
  UpdateSkuImageRequestDto,
} from '../dto/barcode-image.dto';
import { BarcodeService } from '../services/barcode.service';
import { SkuService } from '../services/sku.service';
import { SkuImageService } from '../services/sku-image.service';

class SkuListEnvelopeDto {
  success!: true;
  data!: SkuListItemDto[];
  meta!: PageMeta;
}

class SkuEnvelopeDto {
  success!: true;
  data!: SkuResponseDto;
}

class BarcodeListEnvelopeDto {
  success!: true;
  data!: BarcodeResponseDto[];
}

class BarcodeEnvelopeDto {
  success!: true;
  data!: BarcodeResponseDto;
}

class ImageListEnvelopeDto {
  success!: true;
  data!: SkuImageResponseDto[];
}

class ImageEnvelopeDto {
  success!: true;
  data!: SkuImageResponseDto;
}

@ApiTags('skus')
@Controller()
export class SkuController {
  constructor(
    private readonly skuService: SkuService,
    private readonly barcodeService: BarcodeService,
    private readonly imageService: SkuImageService,
  ) {}

  // ---- SKU master data ----

  @Get('skus')
  @ApiOperation({ summary: 'List SKUs (paged; filters incl. hasListing/platformId/storeId)' })
  @ApiOkResponse({ type: SkuListEnvelopeDto })
  async list(@Query() query: SkuListQueryDto & PaginationQueryDto): Promise<SkuListEnvelopeDto> {
    const { items, meta } = await this.skuService.list(query);
    return okPage(items, meta);
  }

  @Post('skus')
  @ApiOperation({ summary: 'Create an internal SKU (code auto-generated when omitted)' })
  @ApiOkResponse({ type: SkuEnvelopeDto })
  async create(
    @Body() dto: CreateSkuRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SkuEnvelopeDto> {
    return ok(await this.skuService.create(dto, operator));
  }

  @Get('skus/:id')
  @ApiOperation({ summary: 'Get SKU detail' })
  @ApiOkResponse({ type: SkuEnvelopeDto })
  async getById(@Param('id') id: string): Promise<SkuEnvelopeDto> {
    return ok(await this.skuService.getById(id));
  }

  @Patch('skus/:id')
  @ApiOperation({ summary: 'Update SKU fields (volume always recomputed server-side)' })
  @ApiOkResponse({ type: SkuEnvelopeDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSkuRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SkuEnvelopeDto> {
    return ok(await this.skuService.update(id, dto, operator));
  }

  @Post('skus/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a SKU' })
  @ApiOkResponse({ type: SkuEnvelopeDto })
  async activate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SkuEnvelopeDto> {
    return ok(await this.skuService.setStatus(id, 'ACTIVE', operator));
  }

  @Post('skus/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a SKU' })
  @ApiOkResponse({ type: SkuEnvelopeDto })
  async deactivate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SkuEnvelopeDto> {
    return ok(await this.skuService.setStatus(id, 'INACTIVE', operator));
  }

  // ---- Barcodes ----

  @Get('skus/:skuId/barcodes')
  @ApiOperation({ summary: 'List barcodes of a SKU' })
  @ApiOkResponse({ type: BarcodeListEnvelopeDto })
  async listBarcodes(@Param('skuId') skuId: string): Promise<BarcodeListEnvelopeDto> {
    return ok(await this.barcodeService.listBySku(skuId));
  }

  @Post('skus/:skuId/barcodes')
  @ApiOperation({ summary: 'Add a barcode (globally unique; first becomes primary)' })
  @ApiOkResponse({ type: BarcodeEnvelopeDto })
  async createBarcode(
    @Param('skuId') skuId: string,
    @Body() dto: CreateBarcodeRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<BarcodeEnvelopeDto> {
    return ok(await this.barcodeService.create(skuId, dto, operator));
  }

  @Post('skus/:skuId/barcodes/generate-internal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate an INTERNAL barcode (WCSKU%08d) for the SKU' })
  @ApiOkResponse({ type: BarcodeEnvelopeDto })
  async generateInternalBarcode(
    @Param('skuId') skuId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<BarcodeEnvelopeDto> {
    return ok(await this.barcodeService.generateInternal(skuId, operator));
  }

  @Patch('skus/:skuId/barcodes/:barcodeId')
  @ApiOperation({ summary: 'Update a barcode (type/primary/status)' })
  @ApiOkResponse({ type: BarcodeEnvelopeDto })
  async updateBarcode(
    @Param('skuId') skuId: string,
    @Param('barcodeId') barcodeId: string,
    @Body() dto: UpdateBarcodeRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<BarcodeEnvelopeDto> {
    return ok(await this.barcodeService.update(skuId, barcodeId, dto, operator));
  }

  @Delete('skus/:skuId/barcodes/:barcodeId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an unreferenced barcode' })
  async deleteBarcode(
    @Param('skuId') skuId: string,
    @Param('barcodeId') barcodeId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    await this.barcodeService.delete(skuId, barcodeId, operator);
    return ok({});
  }

  // ---- Images ----

  @Get('skus/:skuId/images')
  @ApiOperation({ summary: 'List SKU images (signed URLs)' })
  @ApiOkResponse({ type: ImageListEnvelopeDto })
  async listImages(@Param('skuId') skuId: string): Promise<ImageListEnvelopeDto> {
    return ok(await this.imageService.listBySku(skuId));
  }

  @Post('skus/:skuId/images')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a SKU image (png/jpeg/webp/gif, max 5MB)' })
  @ApiOkResponse({ type: ImageEnvelopeDto })
  async uploadImage(
    @Param('skuId') skuId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ImageEnvelopeDto> {
    return ok(
      await this.imageService.upload(
        skuId,
        { buffer: file.buffer, mimeType: file.mimetype, size: file.size },
        operator,
      ),
    );
  }

  @Patch('skus/:skuId/images/:imageId')
  @ApiOperation({ summary: 'Update image sort order / primary flag' })
  @ApiOkResponse({ type: ImageEnvelopeDto })
  async updateImage(
    @Param('skuId') skuId: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateSkuImageRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ImageEnvelopeDto> {
    return ok(await this.imageService.update(skuId, imageId, dto, operator));
  }

  @Delete('skus/:skuId/images/:imageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an image (DB row + object)' })
  async deleteImage(
    @Param('skuId') skuId: string,
    @Param('imageId') imageId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    await this.imageService.delete(skuId, imageId, operator);
    return ok({});
  }
}
