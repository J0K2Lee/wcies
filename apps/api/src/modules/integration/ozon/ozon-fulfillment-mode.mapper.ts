/**
 * integration_type_flow is the sole source (ozon.md, verified 2026-09-17).
 * Keep unknown strings verbatim; never infer FBO from an FBS endpoint.
 * Shared by the posting mapper and the historical-fact backfill.
 */
export function mapOzonFulfillmentMode(flow: unknown): string | null {
  if (typeof flow !== 'string' || flow === '') {
    return null;
  }
  switch (flow) {
    case 'FBP':
      return 'FBP';
    case 'ozon':
      return 'FBS';
    case 'aggregator':
    case 'non_integrated':
    case '3pl_tracking':
      return 'RFBS';
    default:
      return flow;
  }
}
