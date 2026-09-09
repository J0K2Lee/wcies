import {
  Body,
  Controller,
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
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { ShipmentService } from '../services/shipment.service';
import { ShipmentShipService } from '../services/shipment-ship.service';
import { ShippingLabelService } from '../services/shipping-label.service';
import { PackingService } from '../services/packing.service';
import {
  CreatePackageResultDto,
  CreateShipmentRequestDto,
  CreateShipmentResultDto,
  PackageWorkbenchDto,
  PackingScanRequestDto,
  PackingScanResultDto,
  SealPackageRequestDto,
  SealPackageResultDto,
  ShipShipmentRequestDto,
  ShipShipmentResultDto,
  ShipmentDetailDto,
  ShipmentListItemDto,
  ShipmentListQueryDto,
  ShippingLabelDto,
  UpdateShipmentTrackingRequestDto,
} from '../dto/shipment.dto';

@ApiTags('shipments')
@Controller('shipments')
export class ShipmentController {
  constructor(
    private readonly shipmentService: ShipmentService,
    private readonly shipService: ShipmentShipService,
    private readonly labelService: ShippingLabelService,
    private readonly packingService: PackingService,
  ) {}

  @Get()
  @ApiOperation({ summary: '发货单列表（分页 + 包裹汇总）' })
  @ApiOkPagedEnvelope(ShipmentListItemDto)
  async list(@Query() query: ShipmentListQueryDto) {
    const result = await this.shipmentService.list(query, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return okPage<ShipmentListItemDto>(result.items, result.meta);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '从订单的 PICKED 行创建发货单（按仓拆分）' })
  @ApiOkEnvelope(CreateShipmentResultDto)
  async create(
    @Body() request: CreateShipmentRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<CreateShipmentResultDto>({
      shipments: await this.shipmentService.createShipmentsFromOrder(request.orderId, operator),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '发货单详情（待发商品 / 包裹进度 / 面单 / 物流信息）' })
  @ApiOkEnvelope(ShipmentDetailDto)
  async get(@Param('id') id: string) {
    return ok<ShipmentDetailDto>(await this.shipmentService.getDetail(id));
  }

  @Post(':id/packages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建包裹（发货单进入 PACKING）' })
  @ApiOkEnvelope(CreatePackageResultDto)
  async createPackage(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok<CreatePackageResultDto>(await this.packingService.createPackage(id, operator));
  }

  @Patch(':id/tracking')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '人工录入/修改物流单号与承运商（未出库前）' })
  @ApiOkEnvelope(ShipmentDetailDto)
  async updateTracking(
    @Param('id') id: string,
    @Body() request: UpdateShipmentTrackingRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<ShipmentDetailDto>(await this.shipmentService.updateTracking(id, request, operator));
  }

  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '正式出库（原子扣减 Picked/OnHand，幂等，不重复扣减）' })
  @ApiOkEnvelope(ShipShipmentResultDto)
  async ship(
    @Param('id') id: string,
    @Body() request: ShipShipmentRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<ShipShipmentResultDto>(
      await this.shipService.shipShipment(
        id,
        {
          trackingNumber: request.tracking?.trackingNumber,
          carrierCode: request.tracking?.carrierCode,
          shippingMethod: request.tracking?.shippingMethod,
          idempotencyKey: request.idempotencyKey,
        },
        operator,
      ),
    );
  }

  @Post(':id/labels')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '手工上传面单文件（PDF/PNG/JPEG，私有桶 + 签名访问）' })
  @ApiOkEnvelope(ShippingLabelDto)
  async uploadLabel(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentOperator() operator: OperatorContext,
  ) {
    const label = await this.labelService.upload(
      id,
      { fileName: file.originalname, mimeType: file.mimetype, buffer: file.buffer },
      operator,
    );
    return ok<ShippingLabelDto>(label);
  }

  @Get(':id/labels')
  @ApiOperation({ summary: '面单列表（含短期签名查看 URL）' })
  @ApiOkEnvelope(ShippingLabelDto)
  async listLabels(@Param('id') id: string) {
    return ok<ShippingLabelDto[]>(await this.labelService.listByShipment(id));
  }
}

@ApiTags('packages')
@Controller('packages')
export class PackageController {
  constructor(private readonly packingService: PackingService) {}

  @Get(':id/workbench')
  @ApiOperation({ summary: '打包工作台数据（待装商品 + 已装明细 + SN 进度）' })
  @ApiOkEnvelope(PackageWorkbenchDto)
  async workbench(@Param('id') id: string) {
    return ok(await this.packingService.getPackageWorkbench(id));
  }

  @Post(':id/items/scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '扫码装箱（每次 1 件；SN 商品必带 serialNumber；不改变库存）' })
  @ApiOkEnvelope(PackingScanResultDto)
  async scan(
    @Param('id') id: string,
    @Body() request: PackingScanRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<PackingScanResultDto>(await this.packingService.scanItem(id, request, operator));
  }

  @Post(':id/seal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '封箱（OPEN/REPACK_REQUIRED → SEALED；齐全后发货单 READY_TO_SHIP）' })
  @ApiOkEnvelope(SealPackageResultDto)
  async seal(
    @Param('id') id: string,
    @Body() request: SealPackageRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<SealPackageResultDto>(
      await this.packingService.sealPackage(id, request.dimensions ?? {}, operator),
    );
  }
}
