import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * Runtime TypeORM connection. Schema changes happen exclusively through
 * migrations run by the CLI datasource (`apps/api/src/database/datasource.ts`),
 * never by runtime sync (AGENTS.md §55): `synchronize` is false in every env.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        // getOrThrow: a missing URL must fail fast, not fall back to defaults.
        url: config.getOrThrow<string>('app.databaseUrl'),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        logging: false,
        poolSize: 10,
        // TypeORM 0.3 quirk: uuidExtension 'pgcrypto' selects the PG13+
        // native gen_random_uuid() generator (default emits uuid_generate_v4(),
        // which requires the uuid-ossp extension).
        uuidExtension: 'pgcrypto' as const,
      }),
    }),
  ],
})
export class DatabaseModule {}
