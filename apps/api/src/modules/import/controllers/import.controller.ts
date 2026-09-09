import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ImportJobResponseDto, ImportListQueryDto } from '../dto/import.dto';
import { ImportService } from '../import.service';

@ApiTags('imports')
@Controller('imports')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a fixed-template Excel, parse + validate, return the error report',
  })
  @ApiOkEnvelope(ImportJobResponseDto)
  async upload(
    @Query('type') type: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ImportJobResponseDto }> {
    const job = await this.importService.uploadAndValidate(
      type,
      { buffer: file.buffer, originalFilename: file.originalname, size: file.size },
      operator,
    );
    return ok(this.importService.toResponse(job));
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Confirm import: enqueues the job to the import worker' })
  @ApiOkEnvelope(ImportJobResponseDto)
  async confirm(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ImportJobResponseDto }> {
    const job = await this.importService.confirm(id, operator);
    return ok(this.importService.toResponse(job));
  }

  @Get()
  @ApiOperation({ summary: 'List import jobs' })
  @ApiOkPagedEnvelope(ImportJobResponseDto)
  async list(
    @Query() query: ImportListQueryDto,
  ): Promise<{ success: true; data: ImportJobResponseDto[]; meta: PageMeta }> {
    const { items, total } = await this.importService.list(
      { importType: query.importType, status: query.status },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(
      items.map((job) => this.importService.toResponse(job)),
      {
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Import job detail incl. row-level errors' })
  @ApiOkEnvelope(ImportJobResponseDto)
  async getById(@Param('id') id: string): Promise<{ success: true; data: ImportJobResponseDto }> {
    const job = await this.importService.getById(id);
    return ok(this.importService.toResponse(job));
  }
}
