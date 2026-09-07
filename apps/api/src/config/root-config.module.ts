import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './env.validation';
import { appConfig } from './configuration';

/**
 * Shared root ConfigModule factory for both the HTTP API (main.ts) and the
 * worker process (worker.ts). ENV files resolve from the package dir or the
 * monorepo root, whichever exists.
 */
export function createRootConfigModule(): ReturnType<typeof ConfigModule.forRoot> {
  return ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: ['.env', '../../.env'],
    load: [appConfig],
    validationSchema: envValidationSchema,
    validationOptions: { abortEarly: false, allowUnknown: true },
  });
}
