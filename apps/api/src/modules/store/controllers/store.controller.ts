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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
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

class StoreListEnvelopeDto {
  success!: true;
  data!: StoreListItemDto[];
  meta!: PageMeta;
}

class StoreEnvelopeDto {
  success!: true;
  data!: StoreResponseDto;
}

@ApiTags('stores')
@Controller('stores')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Get()
  @ApiOperation({ summary: 'List stores (paged, with credential + binding counts)' })
  @ApiOkResponse({ type: StoreListEnvelopeDto })
  async list(@Query() query: StoreListQueryDto): Promise<StoreListEnvelopeDto> {
    const { items, meta } = await this.storeService.list(query);
    return okPage(items, meta);
  }

  @Post()
  @ApiOperation({ summary: 'Create a store on a platform' })
  @ApiOkResponse({ type: StoreEnvelopeDto })
  async create(
    @Body() dto: CreateStoreRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<StoreEnvelopeDto> {
    return ok(await this.storeService.create(dto, operator));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get store detail' })
  @ApiOkResponse({ type: StoreEnvelopeDto })
  async getById(@Param('id') id: string): Promise<StoreEnvelopeDto> {
    return ok(await this.storeService.getById(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update store fields (code and platform immutable)' })
  @ApiOkResponse({ type: StoreEnvelopeDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStoreRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<StoreEnvelopeDto> {
    return ok(await this.storeService.update(id, dto, operator));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a store' })
  @ApiOkResponse({ type: StoreEnvelopeDto })
  async activate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<StoreEnvelopeDto> {
    return ok(await this.storeService.setStatus(id, 'ACTIVE', operator));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a store (no hard delete)' })
  @ApiOkResponse({ type: StoreEnvelopeDto })
  async deactivate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<StoreEnvelopeDto> {
    return ok(await this.storeService.setStatus(id, 'INACTIVE', operator));
  }
}
