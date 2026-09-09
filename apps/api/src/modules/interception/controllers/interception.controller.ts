import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { InterceptionService } from '../services/interception.service';
import {
  AssignInterceptionRequestDto,
  FailInterceptionRequestDto,
  InterceptionDetailDto,
  InterceptionListItemDto,
  InterceptionListQueryDto,
  InterceptionScanRequestDto,
  ReturnToStockRequestDto,
} from '../dto/interception.dto';

@ApiTags('interceptions')
@Controller('interceptions')
export class InterceptionController {
  constructor(private readonly interceptionService: InterceptionService) {}

  @Get()
  @ApiOperation({ summary: '拦截任务列表（分页）' })
  @ApiOkPagedEnvelope(InterceptionListItemDto)
  async list(@Query() query: InterceptionListQueryDto) {
    const result = await this.interceptionService.list(query, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return okPage<InterceptionListItemDto>(result.items, result.meta);
  }

  @Get(':id')
  @ApiOperation({ summary: '拦截任务详情（要找什么/在哪找/SN/目标库位/历史）' })
  @ApiOkEnvelope(InterceptionDetailDto)
  async get(@Param('id') id: string) {
    return ok<InterceptionDetailDto>(await this.interceptionService.getDetail(id));
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '指派员工（CREATED → ASSIGNED）' })
  @ApiOkEnvelope(InterceptionDetailDto)
  async assign(
    @Param('id') id: string,
    @Body() request: AssignInterceptionRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<InterceptionDetailDto>(await this.interceptionService.assign(id, request, operator));
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '开始查找（CREATED/ASSIGNED → LOCATING）' })
  @ApiOkEnvelope(InterceptionDetailDto)
  async start(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok<InterceptionDetailDto>(await this.interceptionService.start(id, operator));
  }

  @Post(':id/scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '拦截扫码：验证 SKU / SN / 目标库位（→ INTERCEPTED，不改库存）' })
  @ApiOkEnvelope(InterceptionDetailDto)
  async scan(
    @Param('id') id: string,
    @Body() request: InterceptionScanRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<InterceptionDetailDto>(await this.interceptionService.scan(id, request, operator));
  }

  @Post(':id/return-to-stock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '回库（原子：Picked - N，OnHand 不变，SN → IN_STOCK，Package 解除）',
  })
  @ApiOkEnvelope(InterceptionDetailDto)
  async returnToStock(
    @Param('id') id: string,
    @Body() request: ReturnToStockRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<InterceptionDetailDto>(
      await this.interceptionService.returnToStock(id, request, operator),
    );
  }

  @Post(':id/fail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '标记失败（未找到商品；库存保持 Picked + 异常）' })
  @ApiOkEnvelope(InterceptionDetailDto)
  async fail(
    @Param('id') id: string,
    @Body() request: FailInterceptionRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<InterceptionDetailDto>(await this.interceptionService.fail(id, request, operator));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '关闭拦截任务（RETURNED_TO_STOCK/FAILED → CLOSED）' })
  @ApiOkEnvelope(InterceptionDetailDto)
  async close(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok<InterceptionDetailDto>(await this.interceptionService.close(id, operator));
  }
}
