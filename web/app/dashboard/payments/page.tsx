'use client';

import { EntityView } from '@/components/console/EntityView';

export default function PaymentsPage() {
  return (
    <EntityView
      kind="payment"
      title="Payments"
      sub="Not a payments table — a fold of the event log. Every row is derived at request time, and the exposure column is what is already committed against that payment but not yet closed out."
    />
  );
}
