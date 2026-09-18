import { YxAuth } from './yandex.client';
import { StoreCredentialMalformedError } from '../integration.errors';

/**
 * YANDEX credential parsing, shared by the adapter and the Yandex-specific
 * services that call the client directly (shipment operations).
 *
 * Lives in its own module - NOT in yandex.adapter.ts - because the adapter
 * depends on YandexShipmentService, so the service importing back from the
 * adapter would create a cycle. Same validation, same error either way.
 */
export function parseYxAuth(
  credential: Readonly<Record<string, unknown>>,
  storeId: string,
): YxAuth {
  const apiKey = credential['apiKey'];
  if (typeof apiKey !== 'string' || apiKey === '') {
    throw new StoreCredentialMalformedError(storeId, 'YANDEX', 'expected { apiKey, campaignId? }');
  }
  return { apiKey };
}
