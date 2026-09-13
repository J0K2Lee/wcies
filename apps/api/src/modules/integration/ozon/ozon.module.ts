import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OzonAdapter } from './ozon.adapter';
import { OzonClientFactory } from './ozon-client.factory';
import { OzonClient } from './ozon.client';
import { PlatformAdapterRegistry } from '../platform-adapter.registry';
import { PlatformCategoryNodeEntity } from './entities/platform-category-node.entity';
import { PlatformCategoryNodeRepository } from './repositories/platform-category-node.repository';
import { OzonCategoryTreeService } from './ozon-category-tree.service';

/** OZON platform wiring: one adapter instance per process. */
@Module({
  imports: [TypeOrmModule.forFeature([PlatformCategoryNodeEntity])],
  providers: [
    OzonClientFactory,
    {
      provide: OzonClient,
      useFactory: (factory: OzonClientFactory) => factory.create(),
      inject: [OzonClientFactory],
    },
    OzonAdapter,
    PlatformCategoryNodeRepository,
    OzonCategoryTreeService,
  ],
  exports: [OzonAdapter, OzonCategoryTreeService],
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
