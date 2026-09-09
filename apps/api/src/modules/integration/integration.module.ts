import { Global, Module } from '@nestjs/common';
import { PlatformAdapterRegistry } from './platform-adapter.registry';
import { OzonModule } from './ozon/ozon.module';

/**
 * Platform integration root (Sprint 5 task §7).
 *
 * Hosts the adapter registry; each platform contributes its own submodule
 * and registers its adapter. Core business modules never import this
 * module's internals - they resolve adapters through the registry token.
 */
@Global()
@Module({
  imports: [OzonModule],
  providers: [PlatformAdapterRegistry],
  exports: [PlatformAdapterRegistry],
})
export class IntegrationModule {}
