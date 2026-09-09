import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { PickingService } from '../services/picking.service';
import {
  CreatePickingTaskRequestDto,
  CreatePickingTaskResultDto,
  PickingScanRequestDto,
  PickingScanResultDto,
  PickingTaskDetailDto,
  PickingTaskListItemDto,
  PickingTaskListQueryDto,
} from '../dto/picking.dto';

@ApiTags('picking-tasks')
@Controller('picking-tasks')
export class PickingController {
  constructor(private readonly pickingService: PickingService) {}

  @Get()
  @ApiOperation({ summary: '拣货任务列表（分页 + 进度汇总）' })
  @ApiOkPagedEnvelope(PickingTaskListItemDto)
  async list(@Query() query: PickingTaskListQueryDto) {
    const result = await this.pickingService.list(query, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return okPage<PickingTaskListItemDto>(result.items, result.meta);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '从订单创建拣货任务（仅 RESERVED 行，按仓拆分）' })
  @ApiOkEnvelope(CreatePickingTaskResultDto)
  async create(
    @Body() request: CreatePickingTaskRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<CreatePickingTaskResultDto>({
      tasks: await this.pickingService.createPickingTask(request.orderId, operator),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '拣货任务详情（待拣 SKU / 多 Bin / SN）' })
  @ApiOkEnvelope(PickingTaskDetailDto)
  async get(@Param('id') id: string) {
    return ok<PickingTaskDetailDto>(await this.pickingService.getDetail(id));
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '开始拣货任务（CREATED → IN_PROGRESS）' })
  @ApiOkEnvelope(PickingTaskDetailDto)
  async start(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok<PickingTaskDetailDto>(await this.pickingService.start(id, operator));
  }

  @Post(':id/scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '扫码拣货（每次 1 件；SN 商品必带 serialNumber）' })
  @ApiOkEnvelope(PickingScanResultDto)
  async scan(
    @Param('id') id: string,
    @Body() request: PickingScanRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<PickingScanResultDto>(await this.pickingService.scan(id, request, operator));
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '完成拣货任务（校验全部行已拣完）' })
  @ApiOkEnvelope(PickingTaskDetailDto)
  async complete(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok<PickingTaskDetailDto>(await this.pickingService.complete(id, operator));
  }
}
