import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { ExceptionService } from '../services/exception.service';
import {
  ExceptionCloseRequestDto,
  ExceptionItemDto,
  ExceptionListQueryDto,
} from '../dto/exception.dto';

@ApiTags('exceptions')
@Controller('exceptions')
export class ExceptionController {
  constructor(private readonly exceptionService: ExceptionService) {}

  @Get()
  @ApiOperation({ summary: '异常列表（分页，可按订单行引用过滤）' })
  @ApiOkPagedEnvelope(ExceptionItemDto)
  async list(@Query() query: ExceptionListQueryDto) {
    const result = await this.exceptionService.list(query, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return okPage<ExceptionItemDto>(result.items, result.meta);
  }

  @Get(':id')
  @ApiOperation({ summary: '异常详情' })
  @ApiOkEnvelope(ExceptionItemDto)
  async get(@Param('id') id: string) {
    return ok<ExceptionItemDto>(await this.exceptionService.findById(id));
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '解决异常（OPEN → RESOLVED）' })
  @ApiOkEnvelope(ExceptionItemDto)
  async resolve(
    @Param('id') id: string,
    @Body() request: ExceptionCloseRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<ExceptionItemDto>(await this.exceptionService.resolve(id, operator, request.remark));
  }

  @Post(':id/ignore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '忽略异常（OPEN → IGNORED）' })
  @ApiOkEnvelope(ExceptionItemDto)
  async ignore(
    @Param('id') id: string,
    @Body() request: ExceptionCloseRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<ExceptionItemDto>(await this.exceptionService.ignore(id, operator, request.remark));
  }
}
