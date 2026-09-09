import { Injectable } from '@nestjs/common';
import { StoreContext } from '@wcies/platform-contracts';
import { PlatformAdapter } from '@wcies/platform-contracts';
import { PlatformService } from '../../platform/platform.service';
import { StoreService } from '../../store/services/store.service';
import { PlatformCredentialService } from '../../store/services/platform-credential.service';
import { StoreNotFoundError } from '../../store/errors/store-errors';
import {
  StoreCredentialMalformedError,
  StoreCredentialMissingError,
} from '../../integration/integration.errors';
import { PlatformAdapterRegistry } from '../../integration/platform-adapter.registry';

/** Store record shape as published by StoreService (no entity import needed). */
type StoreRecord = NonNullable<Awaited<ReturnType<StoreService['getEntityById']>>>;

/**
 * Assembles the decrypted store context for platform calls (Sprint 5 task
 * §32): store -> platform code -> ACTIVE MAIN_API credential -> decrypt.
 * Secrets live only inside the returned context - never logged, never
 * returned by any API (AGENTS.md §29).
 */
@Injectable()
export class SyncContextService {
  constructor(
    private readonly storeService: StoreService,
    private readonly platformService: PlatformService,
    private readonly credentialService: PlatformCredentialService,
    private readonly registry: PlatformAdapterRegistry,
  ) {}

  /** Resolves store + adapter; throws DomainErrors on any missing piece. */
  async resolveSyncableStore(
    storeId: string,
  ): Promise<{ store: StoreRecord; adapter: PlatformAdapter }> {
    const store = await this.storeService.getEntityById(storeId);
    if (store === null || store.status !== 'ACTIVE') {
      throw new StoreNotFoundError(storeId);
    }
    const platform = await this.platformService.getEntityById(store.platformId);
    if (platform === null || !this.registry.has(platform.code)) {
      throw new StoreNotFoundError(storeId);
    }
    return { store, adapter: this.registry.getAdapter(platform.code) };
  }

  /** Decrypted context for adapter calls. */
  async buildStoreContext(store: StoreRecord): Promise<StoreContext> {
    const payload = await this.credentialService.getDecryptedActivePayload(store.id, 'MAIN_API');
    if (payload === null) {
      throw new StoreCredentialMissingError(store.id, 'MAIN_API');
    }
    if (typeof payload !== 'object' || payload === null) {
      throw new StoreCredentialMalformedError(store.id, 'unknown', 'payload is not an object');
    }
    const platform = await this.platformService.getEntityById(store.platformId);
    const platformCode = platform?.code ?? 'OZON';
    return {
      storeId: store.id,
      storeCode: store.storeCode,
      platform: this.registry.getAdapter(platformCode).platformCode,
      credential: payload,
    };
  }

  /** Credential clientId (seller id) for webhook identity matching. */
  async credentialClientId(storeId: string): Promise<string | null> {
    const payload = await this.credentialService.getDecryptedActivePayload(storeId, 'MAIN_API');
    if (payload === null) {
      return null;
    }
    const clientId = payload['clientId'];
    return typeof clientId === 'string' ? clientId : null;
  }
}
