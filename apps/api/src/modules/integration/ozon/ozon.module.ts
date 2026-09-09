import { Module, OnModuleInit } from '@nestjs/common';
import { OzonAdapter } from './ozon.adapter';
import { OzonClientFactory } from './ozon-client.factory';
import { OzonClient } from './ozon.client';
import { PlatformAdapterRegistry } from '../platform-adapter.registry';

/** OZON platform wiring: one adapter instance per process. */
@Module({
  providers: [
    OzonClientFactory,
    {
      provide: OzonClient,
      useFactory: (factory: OzonClientFactory) => factory.create(),
      inject: [OzonClientFactory],
    },
    OzonAdapter,
  ],
  exports: [OzonAdapter],
})
export class OzonModule implements OnModuleInit {
  constructor(
    private readonly registry: PlatformAdapterRegistry,
    private readonly adapter: OzonAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.adapter);
  }
}
