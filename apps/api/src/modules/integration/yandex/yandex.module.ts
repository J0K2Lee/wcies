import { Module, OnModuleInit } from '@nestjs/common';
import { PlatformAdapterRegistry } from '../platform-adapter.registry';
import { YandexAdapter } from './yandex.adapter';
import { YandexClient } from './yandex.client';
import { YandexClientFactory } from './yandex-client.factory';
import { YandexWarehouseService } from './yandex-warehouse.service';
import { YandexShipmentService } from './yandex-shipment.service';

/** Yandex Market platform wiring: one adapter instance per process. */
@Module({
  providers: [
    YandexClientFactory,
    {
      provide: YandexClient,
      useFactory: (factory: YandexClientFactory) => factory.create(),
      inject: [YandexClientFactory],
    },
    YandexAdapter,
    YandexWarehouseService,
    YandexShipmentService,
  ],
  exports: [YandexAdapter, YandexWarehouseService, YandexShipmentService],
})
export class YandexModule implements OnModuleInit {
  constructor(
    private readonly registry: PlatformAdapterRegistry,
    private readonly adapter: YandexAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.adapter);
  }
}
