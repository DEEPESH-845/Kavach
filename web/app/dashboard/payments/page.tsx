'use client';

import { EntityView } from '@/components/console/EntityView';

export default function PaymentsPage() {
  return (
    <EntityView
      kind="payment"
      title="Payments"
      sub="Not a stored payments table — every row here is rebuilt from the event log as you load the page. “Exposure” is money already promised against that payment but not yet confirmed as delivered."
    />
  );
}
