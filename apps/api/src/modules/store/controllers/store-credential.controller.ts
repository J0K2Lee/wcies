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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { ApiOkArrayEnvelope, ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { CredentialResponseDto, UpsertCredentialRequestDto } from '../dto/credential.dto';
import { PlatformCredentialService } from '../services/platform-credential.service';
import { CredentialValidationService } from '../services/credential-validation.service';
import { CredentialValidateResultDto } from '../dto/credential.dto';

/**
 * Store credentials - admin only (spec §61/§115). Responses expose metadata
 * only; the encrypted payload never leaves the server.
 */
@ApiTags('store-credentials')
@UseGuards(AdminGuard)
@Controller('stores/:storeId/credentials')
export class StoreCredentialController {
  constructor(
    private readonly credentialService: PlatformCredentialService,
    private readonly validationService: CredentialValidationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List credential metadata for a store (no secrets)' })
  @ApiOkArrayEnvelope(CredentialResponseDto)
  async list(
    @Param('storeId') storeId: string,
  ): Promise<{ success: true; data: CredentialResponseDto[] }> {
    return ok(await this.credentialService.listByStore(storeId));
  }

  @Post()
  @ApiOperation({ summary: 'Create a credential (payload encrypted at rest)' })
  @ApiOkEnvelope(CredentialResponseDto)
  async create(
    @Param('storeId') storeId: string,
    @Body() dto: UpsertCredentialRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: CredentialResponseDto }> {
    return ok(await this.credentialService.create(storeId, dto, operator));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Replace the credential payload (re-encrypted)' })
  @ApiOkEnvelope(CredentialResponseDto)
  async updatePayload(
    @Param('storeId') storeId: string,
    @Param('id') credentialId: string,
    @Body() dto: UpsertCredentialRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: CredentialResponseDto }> {
    return ok(
      await this.credentialService.updatePayload(storeId, credentialId, dto.payload, operator),
    );
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '验证连接（安全 Read-only 调用；不返回任何密钥）' })
  @ApiOkEnvelope(CredentialValidateResultDto)
  async validate(
    @Param('storeId') storeId: string,
    @Param('id') credentialId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: CredentialValidateResultDto }> {
    return ok(await this.validationService.validate(storeId, credentialId, operator));
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable a credential' })
  @ApiOkEnvelope(CredentialResponseDto)
  async disable(
    @Param('storeId') storeId: string,
    @Param('id') credentialId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: CredentialResponseDto }> {
    return ok(await this.credentialService.disable(storeId, credentialId, operator));
  }
}
