import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { SystemSettingsService } from '../services/system-settings.service';
import { SystemSettingsDto, UpdateSystemSettingsRequestDto } from '../dto/system-settings.dto';

/**
 * 系统运行参数（2026-10-27）。读取对所有登录用户开放（系统管理页展示当前值），
 * 修改仅管理员（与平台优先级同一套 AdminGuard）。
 */
@ApiTags('system')
@Controller('system/settings')
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService) {}

  @Get()
  @ApiOperation({ summary: '系统运行参数（当前生效值）' })
  @ApiOkEnvelope(SystemSettingsDto)
  async get(): Promise<{ success: true; data: SystemSettingsDto }> {
    return ok({ orderFallbackHours: await this.settings.getOrderFallbackHours() });
  }

  @Patch()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '修改系统运行参数（管理员）' })
  @ApiOkEnvelope(SystemSettingsDto)
  async update(
    @Body() request: UpdateSystemSettingsRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SystemSettingsDto }> {
    const orderFallbackHours = await this.settings.updateOrderFallbackHours(
      request.orderFallbackHours ?? {},
      operator,
    );
    return ok({ orderFallbackHours });
  }
}
