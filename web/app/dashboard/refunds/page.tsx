'use client';

import { EntityView } from '@/components/console/EntityView';

export default function RefundsPage() {
  return (
    <EntityView
      kind="refund"
      title="Refunds"
      sub="Rail state and obligation state are shown separately because they are different facts. A refund can be PROCESSING on the rail with its obligation still OPEN — the gateway is done, the customer has not been paid."
    />
  );
}
