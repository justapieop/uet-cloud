export interface CustomerSubscription {
  readonly id: string;
  readonly status: string;
  readonly cancel_at_period_end: boolean;
  readonly cancel_at: number | null;
}
