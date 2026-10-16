import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { PlatformResponseDto } from '../dto/platform-response.dto';
import { UpdatePlatformPriorityRequestDto } from '../dto/update-platform-priority.dto';
import { PlatformService } from '../platform.service';

/**
 * Platform master data (task §6/§7: users must not create platforms). The
 * only writable field is the assignment priority (ADR 0022) - admin only.
 */
@ApiTags('platforms')
@Controller('platforms')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get()
  @ApiOperation({ summary: 'List platforms (OZON / WB / YANDEX)' })
  @ApiOkEnvelope(PlatformResponseDto)
  async list(): Promise<{ success: true; data: PlatformResponseDto[] }> {
    return ok(await this.platformService.list());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a platform by id' })
  @ApiOkEnvelope(PlatformResponseDto)
  async getById(@Param('id') id: string): Promise<{ success: true; data: PlatformResponseDto }> {
    return ok(await this.platformService.findById(id));
  }

  @Patch(':id/priority')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '更新平台分配优先级（数值小=优先，管理员）' })
  @ApiOkEnvelope(PlatformResponseDto)
  async updatePriority(
    @Param('id') id: string,
    @Body() request: UpdatePlatformPriorityRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: PlatformResponseDto }> {
    return ok(await this.platformService.updatePriority(id, request.priority, operator));
  }
}
