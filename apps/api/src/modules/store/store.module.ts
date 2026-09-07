import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { PlatformModule } from '../platform/platform.module';
import { StoreEntity } from './entities/store.entity';
import { PlatformCredentialEntity } from './entities/platform-credential.entity';
import { StoreRepository } from './repositories/store.repository';
import { PlatformCredentialRepository } from './repositories/platform-credential.repository';
import { StoreService } from './services/store.service';
import { PlatformCredentialService } from './services/platform-credential.service';
import { StoreController } from './controllers/store.controller';
import { StoreCredentialController } from './controllers/store-credential.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([StoreEntity, PlatformCredentialEntity]),
    PlatformModule,
    OperationLogModule,
    CryptoModule,
  ],
  controllers: [StoreController, StoreCredentialController],
  providers: [
    StoreService,
    PlatformCredentialService,
    StoreRepository,
    PlatformCredentialRepository,
  ],
  exports: [StoreService, PlatformCredentialService],
})
export class StoreModule {}
