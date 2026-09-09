import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { PlatformResponseDto } from '../dto/platform-response.dto';
import { PlatformService } from '../platform.service';

/** Read-only platform master data (task §6/§7: users must not create platforms). */
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
}
