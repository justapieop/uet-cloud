import type { CustomerSubscription } from "../model/types";

export const MOCK_MY_SUBSCRIPTIONS: readonly CustomerSubscription[] = [
  {
    id: "sub_demo_active",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
  },
  {
    id: "sub_demo_scheduled_cancel",
    status: "active",
    cancel_at_period_end: true,
    cancel_at: 1_800_000_000,
  },
];

export const MOCK_NO_SUBSCRIPTIONS: readonly CustomerSubscription[] = [];
