import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformEntity } from './entities/platform.entity';
import { PlatformRepository } from './repositories/platform.repository';
import { PlatformService } from './platform.service';
import { PlatformController } from './controllers/platform.controller';
import { OperationLogModule } from '../operation-log/operation-log.module';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformEntity]), OperationLogModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformRepository],
  exports: [PlatformService],
})
export class PlatformModule {}
