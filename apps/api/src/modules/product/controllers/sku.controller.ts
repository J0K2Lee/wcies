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
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
import {
  ApiOkArrayEnvelope,
  ApiOkEnvelope,
  ApiOkNoDataEnvelope,
  ApiOkPagedEnvelope,
} from '../../../common/swagger/api-envelope';
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
  @ApiOkPagedEnvelope(SkuListItemDto)
  async list(
    @Query() query: SkuListQueryDto,
  ): Promise<{ success: true; data: SkuListItemDto[]; meta: PageMeta }> {
    const { items, meta } = await this.skuService.list(query);
    return okPage(items, meta);
  }

  @Post('skus')
  @ApiOperation({ summary: 'Create an internal SKU (code auto-generated when omitted)' })
  @ApiOkEnvelope(SkuResponseDto)
  async create(
    @Body() dto: CreateSkuRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SkuResponseDto }> {
    return ok(await this.skuService.create(dto, operator));
  }

  @Get('skus/:id')
  @ApiOperation({ summary: 'Get SKU detail' })
  @ApiOkEnvelope(SkuResponseDto)
  async getById(@Param('id') id: string): Promise<{ success: true; data: SkuResponseDto }> {
    return ok(await this.skuService.getById(id));
  }

  @Patch('skus/:id')
  @ApiOperation({ summary: 'Update SKU fields (volume always recomputed server-side)' })
  @ApiOkEnvelope(SkuResponseDto)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSkuRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SkuResponseDto }> {
    return ok(await this.skuService.update(id, dto, operator));
  }

  @Delete('skus/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a SKU with zero references (else SKU_IN_USE)' })
  @ApiOkNoDataEnvelope()
  async remove(
    @Param('id') id: string,
    @Query('force') force: string | undefined,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    // force=true also removes the SKU's barcodes, images, bundle links and
    // platform mappings (decision 0008); inventory/order history still refuses.
    if (force === 'true' || force === '1') {
      await this.skuService.forceRemove(id, operator);
    } else {
      await this.skuService.remove(id, operator);
    }
    return ok({});
  }

  @Post('skus/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a SKU' })
  @ApiOkEnvelope(SkuResponseDto)
  async activate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SkuResponseDto }> {
    return ok(await this.skuService.setStatus(id, 'ACTIVE', operator));
  }

  @Post('skus/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a SKU' })
  @ApiOkEnvelope(SkuResponseDto)
  async deactivate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SkuResponseDto }> {
    return ok(await this.skuService.setStatus(id, 'INACTIVE', operator));
  }

  // ---- Barcodes ----

  @Get('skus/:skuId/barcodes')
  @ApiOperation({ summary: 'List barcodes of a SKU' })
  @ApiOkArrayEnvelope(BarcodeResponseDto)
  async listBarcodes(
    @Param('skuId') skuId: string,
  ): Promise<{ success: true; data: BarcodeResponseDto[] }> {
    return ok(await this.barcodeService.listBySku(skuId));
  }

  @Post('skus/:skuId/barcodes')
  @ApiOperation({ summary: 'Add a barcode (globally unique; first becomes primary)' })
  @ApiOkEnvelope(BarcodeResponseDto)
  async createBarcode(
    @Param('skuId') skuId: string,
    @Body() dto: CreateBarcodeRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BarcodeResponseDto }> {
    return ok(await this.barcodeService.create(skuId, dto, operator));
  }

  @Post('skus/:skuId/barcodes/generate-internal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate an INTERNAL barcode (WCSKU%08d) for the SKU' })
  @ApiOkEnvelope(BarcodeResponseDto)
  async generateInternalBarcode(
    @Param('skuId') skuId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BarcodeResponseDto }> {
    return ok(await this.barcodeService.generateInternal(skuId, operator));
  }

  @Patch('skus/:skuId/barcodes/:barcodeId')
  @ApiOperation({ summary: 'Update a barcode (type/primary/status)' })
  @ApiOkEnvelope(BarcodeResponseDto)
  async updateBarcode(
    @Param('skuId') skuId: string,
    @Param('barcodeId') barcodeId: string,
    @Body() dto: UpdateBarcodeRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BarcodeResponseDto }> {
    return ok(await this.barcodeService.update(skuId, barcodeId, dto, operator));
  }

  @Delete('skus/:skuId/barcodes/:barcodeId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an unreferenced barcode' })
  @ApiOkNoDataEnvelope()
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
  @ApiOkArrayEnvelope(SkuImageResponseDto)
  async listImages(
    @Param('skuId') skuId: string,
  ): Promise<{ success: true; data: SkuImageResponseDto[] }> {
    return ok(await this.imageService.listBySku(skuId));
  }

  @Post('skus/:skuId/images')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a SKU image (png/jpeg/webp/gif, max 5MB)' })
  @ApiOkEnvelope(SkuImageResponseDto)
  async uploadImage(
    @Param('skuId') skuId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SkuImageResponseDto }> {
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
  @ApiOkEnvelope(SkuImageResponseDto)
  async updateImage(
    @Param('skuId') skuId: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateSkuImageRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SkuImageResponseDto }> {
    return ok(await this.imageService.update(skuId, imageId, dto, operator));
  }

  @Delete('skus/:skuId/images/:imageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an image (DB row + object)' })
  @ApiOkNoDataEnvelope()
  async deleteImage(
    @Param('skuId') skuId: string,
    @Param('imageId') imageId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    await this.imageService.delete(skuId, imageId, operator);
    return ok({});
  }
}
