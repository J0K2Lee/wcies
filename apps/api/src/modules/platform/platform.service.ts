import { Injectable } from '@nestjs/common';
import { PlatformEntity } from './entities/platform.entity';
import { PlatformNotFoundError } from './errors/platform-errors';
import { PlatformRepository } from './repositories/platform.repository';
import { PlatformResponseDto } from './dto/platform-response.dto';
import { OperatorContext, OperationLogService } from '../operation-log/operation-log.service';

/**
 * Platform master data (read-only for regular users in Sprint 1 - task §6/§7).
 * Rows are seeded by migration; creating new platforms is intentionally not
 * exposed over the API. `updatePriority` (用户指示 2026-10-16, ADR 0022) is
 * the single writable field - the assignment priority, not master data.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly repository: PlatformRepository,
    private readonly operationLog: OperationLogService,
  ) {}

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

  /** 更新平台分配优先级（用户指示 2026-10-16，ADR 0022）：数值小=优先。 */
  async updatePriority(
    id: string,
    priority: number,
    operator: OperatorContext,
  ): Promise<PlatformResponseDto> {
    const platform = await this.repository.findById(id);
    if (platform === null) {
      throw new PlatformNotFoundError(id);
    }
    await this.repository.updatePriority(id, priority);
    await this.operationLog.record({
      entityType: 'PLATFORM',
      entityId: id,
      entityCode: platform.code,
      action: 'UPDATE',
      changes: { priority: { from: platform.priority, to: priority } },
      operator,
    });
    return this.toResponse({ ...platform, priority });
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
      priority: platform.priority,
      createdAt: platform.createdAt,
      updatedAt: platform.updatedAt,
    };
  }
}
