import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { CredentialResponseDto, UpsertCredentialRequestDto } from '../dto/credential.dto';
import { PlatformCredentialService } from '../services/platform-credential.service';

class CredentialListEnvelopeDto {
  success!: true;
  data!: CredentialResponseDto[];
}

class CredentialEnvelopeDto {
  success!: true;
  data!: CredentialResponseDto;
}

/**
 * Store credentials - admin only (spec §61/§115). Responses expose metadata
 * only; the encrypted payload never leaves the server.
 */
@ApiTags('store-credentials')
@UseGuards(AdminGuard)
@Controller('stores/:storeId/credentials')
export class StoreCredentialController {
  constructor(private readonly credentialService: PlatformCredentialService) {}

  @Get()
  @ApiOperation({ summary: 'List credential metadata for a store (no secrets)' })
  @ApiOkResponse({ type: CredentialListEnvelopeDto })
  async list(@Param('storeId') storeId: string): Promise<CredentialListEnvelopeDto> {
    return ok(await this.credentialService.listByStore(storeId));
  }

  @Post()
  @ApiOperation({ summary: 'Create a credential (payload encrypted at rest)' })
  @ApiOkResponse({ type: CredentialEnvelopeDto })
  async create(
    @Param('storeId') storeId: string,
    @Body() dto: UpsertCredentialRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<CredentialEnvelopeDto> {
    return ok(await this.credentialService.create(storeId, dto, operator));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Replace the credential payload (re-encrypted)' })
  @ApiOkResponse({ type: CredentialEnvelopeDto })
  async updatePayload(
    @Param('storeId') storeId: string,
    @Param('id') credentialId: string,
    @Body() dto: UpsertCredentialRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<CredentialEnvelopeDto> {
    return ok(
      await this.credentialService.updatePayload(storeId, credentialId, dto.payload, operator),
    );
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable a credential' })
  @ApiOkResponse({ type: CredentialEnvelopeDto })
  async disable(
    @Param('storeId') storeId: string,
    @Param('id') credentialId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<CredentialEnvelopeDto> {
    return ok(await this.credentialService.disable(storeId, credentialId, operator));
  }
}
