import { Injectable } from '@nestjs/common';
import { PlatformEntity } from './entities/platform.entity';
import { PlatformNotFoundError } from './errors/platform-errors';
import { PlatformRepository } from './repositories/platform.repository';
import { PlatformResponseDto } from './dto/platform-response.dto';

/**
 * Platform master data (read-only for regular users in Sprint 1 - task §6/§7).
 * Rows are seeded by migration; creating new platforms is intentionally not
 * exposed over the API.
 */
@Injectable()
export class PlatformService {
  constructor(private readonly repository: PlatformRepository) {}

  async list(): Promise<PlatformResponseDto[]> {
    const platforms = await this.repository.list();
    return platforms.map((platform) => this.toResponse(platform));
  }

  async findById(id: string): Promise<PlatformResponseDto> {
    const platform = await this.repository.findById(id);
    if (platform === null) {
      throw new PlatformNotFoundError(id);
    }
    return this.toResponse(platform);
  }

  /** Cross-module lookup used by Store/Binding services. */
  async getEntityById(id: string): Promise<PlatformEntity | null> {
    return this.repository.findById(id);
  }

  async getEntityByCode(code: string): Promise<PlatformEntity | null> {
    return this.repository.findByCode(code);
  }

  toResponse(platform: PlatformEntity): PlatformResponseDto {
    return {
      id: platform.id,
      code: platform.code,
      name: platform.name,
      status: platform.status,
      createdAt: platform.createdAt,
      updatedAt: platform.updatedAt,
    };
  }
}
