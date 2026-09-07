import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { ok } from '../../../common/dto/api-response';
import { ObjectStorageService } from '../../../infrastructure/storage/object-storage.service';

export class StorageTestData {
  @ApiProperty({ example: 'dev/storage-test-<uuid>.txt' })
  objectKey!: string;

  @ApiProperty({ example: 'http://localhost:9000/wcies/dev/storage-test-....txt?X-Amz-...' })
  signedUrl!: string;

  @ApiProperty({ example: true })
  verified!: boolean;
}

export class StorageTestResponseDto {
  success!: true;
  data!: StorageTestData;
}

/** [DEV ONLY] Round-trip check: upload -> MinIO -> signed URL -> read back. */
@ApiTags('dev')
@Controller('dev')
export class StorageTestController {
  constructor(private readonly storage: ObjectStorageService) {}

  @Post('storage-test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[DEV ONLY] Upload a test file and read it back via signed URL' })
  @ApiOkResponse({ type: StorageTestResponseDto })
  async runStorageTest(): Promise<StorageTestResponseDto> {
    const objectKey = `dev/storage-test-${randomUUID()}.txt`;
    const content = `wcies storage test ${new Date().toISOString()}`;

    await this.storage.upload({ key: objectKey, body: content, contentType: 'text/plain' });
    const signedUrl = await this.storage.getSignedUrl(objectKey, { expiresInSec: 300 });

    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(`Signed URL read failed with HTTP ${response.status}`);
    }
    const readBack = await response.text();

    return ok<StorageTestData>({
      objectKey,
      signedUrl,
      verified: readBack === content,
    });
  }
}
