import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { BarcodeNotFoundError } from '../errors/barcode-errors';
import { BarcodeResolveDto } from '../dto/barcode-image.dto';
import { BarcodeService } from '../services/barcode.service';

/**
 * Barcode resolution endpoint (Sprint 7 task §12/T5.1) for the receiving
 * workbench - the service-level findByBarcode already powered picking and
 * interception; receiving needs it over HTTP too.
 */
@ApiTags('barcodes')
@Controller('barcodes')
export class BarcodeController {
  constructor(private readonly barcodeService: BarcodeService) {}

  @Get(':barcode/resolve')
  @ApiOperation({ summary: '按条码解析内部 SKU（收货/拣货扫码共用）' })
  @ApiOkEnvelope(BarcodeResolveDto)
  async resolve(
    @Param('barcode') barcode: string,
  ): Promise<{ success: true; data: BarcodeResolveDto }> {
    // Barcodes are globally unique (partial unique index, migration
    // 20260908_008) so this lookup deliberately carries NO store dimension -
    // unlike the Listing Resolver which MUST be store-scoped (AGENTS.md §26).
    // Do not add a storeId parameter here.
    const resolved = await this.barcodeService.resolveBarcode(barcode);
    if (resolved === null) {
      throw new BarcodeNotFoundError(barcode);
    }
    return ok(resolved);
  }
}
