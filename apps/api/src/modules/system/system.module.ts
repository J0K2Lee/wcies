import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { SystemSettingEntity } from './entities/system-setting.entity';
import { SystemSettingRepository } from './repositories/system-setting.repository';
import { SystemSettingsService } from './services/system-settings.service';
import { SystemSettingsController } from './controllers/system-settings.controller';

/**
 * 系统运行参数（2026-10-27）：通用 key/value 配置 + 读取/修改接口。
 * 消费方（订单同步的分阶段回读）通过导出的 service 读取，不直接碰表。
 */
@Module({
  imports: [TypeOrmModule.forFeature([SystemSettingEntity]), OperationLogModule],
  controllers: [SystemSettingsController],
  providers: [SystemSettingRepository, SystemSettingsService],
  exports: [SystemSettingsService],
})
export class SystemModule {}
