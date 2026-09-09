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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import {
  CreateStoreRequestDto,
  StoreListItemDto,
  StoreListQueryDto,
  StoreResponseDto,
  UpdateStoreRequestDto,
} from '../dto/store.dto';
import { StoreService } from '../services/store.service';

@ApiTags('stores')
@Controller('stores')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Get()
  @ApiOperation({ summary: 'List stores (paged, with credential + binding counts)' })
  @ApiOkPagedEnvelope(StoreListItemDto)
  async list(
    @Query() query: StoreListQueryDto,
  ): Promise<{ success: true; data: StoreListItemDto[]; meta: PageMeta }> {
    const { items, meta } = await this.storeService.list(query);
    return okPage(items, meta);
  }

  @Post()
  @ApiOperation({ summary: 'Create a store on a platform' })
  @ApiOkEnvelope(StoreResponseDto)
  async create(
    @Body() dto: CreateStoreRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: StoreResponseDto }> {
    return ok(await this.storeService.create(dto, operator));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get store detail' })
  @ApiOkEnvelope(StoreResponseDto)
  async getById(@Param('id') id: string): Promise<{ success: true; data: StoreResponseDto }> {
    return ok(await this.storeService.getById(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update store fields (code and platform immutable)' })
  @ApiOkEnvelope(StoreResponseDto)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStoreRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: StoreResponseDto }> {
    return ok(await this.storeService.update(id, dto, operator));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a store' })
  @ApiOkEnvelope(StoreResponseDto)
  async activate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: StoreResponseDto }> {
    return ok(await this.storeService.setStatus(id, 'ACTIVE', operator));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a store (no hard delete)' })
  @ApiOkEnvelope(StoreResponseDto)
  async deactivate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: StoreResponseDto }> {
    return ok(await this.storeService.setStatus(id, 'INACTIVE', operator));
  }
}
