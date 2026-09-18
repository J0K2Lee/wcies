import { OzonAuth } from './ozon.client';
import { StoreCredentialMalformedError } from '../integration.errors';

/**
 * OZON credential parsing, shared by the adapter and the OZON-specific
 * services that call the client directly (category tree, warehouse catalog,
 * shipment operations).
 *
 * Lives in its own module - NOT in ozon.adapter.ts - because the adapter now
 * depends on OzonShipmentService, so the service importing back from the
 * adapter would create a cycle. Same validation, same error either way.
 */
export function parseOzonAuth(
  credential: Readonly<Record<string, unknown>>,
  storeId: string,
): OzonAuth {
  const clientId = credential['clientId'];
  const apiKey = credential['apiKey'];
  if (
    typeof clientId !== 'string' ||
    clientId === '' ||
    typeof apiKey !== 'string' ||
    apiKey === ''
  ) {
    throw new StoreCredentialMalformedError(storeId, 'OZON', 'expected { clientId, apiKey }');
  }
  return { clientId, apiKey };
}
