/**
 * Base class for all business (domain) errors.
 *
 * Domain errors carry a stable machine-readable code (`DOMAIN_REASON`,
 * e.g. INVENTORY_INSUFFICIENT_STOCK) plus an HTTP status. Services must throw
 * DomainError subclasses instead of `new Error(...)` (AGENTS.md §65).
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}
