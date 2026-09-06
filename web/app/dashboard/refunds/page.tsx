'use client';

import { EntityView } from '@/components/console/EntityView';

export default function RefundsPage() {
  return (
    <EntityView
      kind="refund"
      title="Refunds"
      sub="Two columns, because these are two different facts. A refund can be PROCESSING at the payment provider while what you owe the customer is still OPEN — the gateway has done its part; the customer has not got the money."
    />
  );
}
