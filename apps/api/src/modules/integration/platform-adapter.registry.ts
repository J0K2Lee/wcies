import { Injectable } from '@nestjs/common';
import { PlatformAdapter } from '@wcies/platform-contracts';
import { PlatformNotSupportedError } from './integration.errors';

/**
 * Platform adapter registry (Sprint 5 task §9).
 *
 * Adapters register themselves here at module init; sync services resolve by
 * platform code. Adding WB / Yandex later means registering a new adapter -
 * never `if (platform === 'OZON')` branches in sync services.
 */
@Injectable()
export class PlatformAdapterRegistry {
  private readonly adapters = new Map<string, PlatformAdapter>();

  register(adapter: PlatformAdapter): void {
    const code = adapter.platformCode;
    const existing = this.adapters.get(code);
    if (existing !== undefined && existing !== adapter) {
      throw new Error(`Duplicate platform adapter registered for ${code}`);
    }
    this.adapters.set(code, adapter);
  }

  has(platformCode: string): boolean {
    return this.adapters.has(platformCode);
  }

  getAdapter(platformCode: string): PlatformAdapter {
    const adapter = this.adapters.get(platformCode);
    if (adapter === undefined) {
      throw new PlatformNotSupportedError(platformCode, [...this.adapters.keys()]);
    }
    return adapter;
  }
}
