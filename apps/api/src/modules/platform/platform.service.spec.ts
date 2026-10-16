import { describe, expect, it, vi } from 'vitest';
import { PlatformService } from './platform.service';
import { PlatformRepository } from './repositories/platform.repository';
import { OperationLogService } from '../operation-log/operation-log.service';
import { PlatformEntity } from './entities/platform.entity';
import { PlatformNotFoundError } from './errors/platform-errors';

const OPERATOR = { userId: null, username: 'test' };

function makePlatform(over: Partial<PlatformEntity> = {}): PlatformEntity {
  return {
    id: 'p1',
    code: 'OZON',
    name: 'OZON',
    status: 'ACTIVE',
    priority: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('PlatformService.updatePriority (2026-10-16 ADR 0022)', () => {
  function build(platform: PlatformEntity | null) {
    const repository = {
      findById: vi.fn().mockResolvedValue(platform),
      updatePriority: vi.fn().mockResolvedValue(undefined),
    } as unknown as PlatformRepository;
    const operationLog = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new PlatformService(repository, operationLog as unknown as OperationLogService);
    return { service, repository, operationLog };
  }

  it('writes the new priority and records an audit entry', async () => {
    const { service, repository, operationLog } = build(makePlatform({ priority: 100 }));
    const result = await service.updatePriority('p1', 10, OPERATOR);
    expect(repository.updatePriority).toHaveBeenCalledWith('p1', 10);
    expect(result.priority).toBe(10);
    expect(operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'PLATFORM',
        entityCode: 'OZON',
        changes: { priority: { from: 100, to: 10 } },
      }),
    );
  });

  it('throws PlatformNotFoundError when the platform does not exist', async () => {
    const { service, repository } = build(null);
    await expect(service.updatePriority('missing', 10, OPERATOR)).rejects.toBeInstanceOf(
      PlatformNotFoundError,
    );
    expect(repository.updatePriority).not.toHaveBeenCalled();
  });
});
