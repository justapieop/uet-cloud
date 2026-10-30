/**
 * Shape expected from the proposed self-service subscriptions API.
 * The endpoint is not implemented yet; these fields mirror the existing backend
 * subscription response without depending on its admin-specific DTO type.
 */
export interface CustomerSubscription {
  readonly id: string;
  readonly status: string;
  readonly cancel_at_period_end: boolean;
  readonly cancel_at: number | null;
}
