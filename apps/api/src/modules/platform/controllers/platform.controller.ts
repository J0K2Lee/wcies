import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { PlatformResponseDto } from '../dto/platform-response.dto';
import { PlatformService } from '../platform.service';

class PlatformListEnvelopeDto {
  success!: true;
  data!: PlatformResponseDto[];
}

class PlatformEnvelopeDto {
  success!: true;
  data!: PlatformResponseDto;
}

/** Read-only platform master data (task §6/§7: users must not create platforms). */
@ApiTags('platforms')
@Controller('platforms')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get()
  @ApiOperation({ summary: 'List platforms (OZON / WB / YANDEX)' })
  @ApiOkResponse({ type: PlatformListEnvelopeDto })
  async list(): Promise<PlatformListEnvelopeDto> {
    return ok(await this.platformService.list());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a platform by id' })
  @ApiOkResponse({ type: PlatformEnvelopeDto })
  async getById(@Param('id') id: string): Promise<PlatformEnvelopeDto> {
    return ok(await this.platformService.findById(id));
  }
}
