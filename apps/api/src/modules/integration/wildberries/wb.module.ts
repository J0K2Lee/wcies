import { Module, OnModuleInit } from '@nestjs/common';
import { PlatformAdapterRegistry } from '../platform-adapter.registry';
import { WbAdapter } from './wb.adapter';
import { WbClient } from './wb.client';
import { WbClientFactory } from './wb-client.factory';
import { WbShipmentService } from './wb-shipment.service';

/** Wildberries platform wiring: one adapter instance per process. */
@Module({
  providers: [
    WbClientFactory,
    {
      provide: WbClient,
      useFactory: (factory: WbClientFactory) => factory.create(),
      inject: [WbClientFactory],
    },
    WbAdapter,
    WbShipmentService,
  ],
  exports: [WbClient, WbAdapter, WbShipmentService],
})
export class WildberriesModule implements OnModuleInit {
  constructor(
    private readonly registry: PlatformAdapterRegistry,
    private readonly adapter: WbAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.adapter);
  }
}
