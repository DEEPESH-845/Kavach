import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ApproveClient } from './ApproveClient';
import '@/app/dashboard/console.css';
import '@/app/shop/bazaar.css';

export const metadata: Metadata = {
  title: 'Approve — Kavach',
  description: 'Your agent wants to spend. Approve or deny on your own device.',
};

export default function ApprovePage() {
  return (
    <Suspense fallback={<div className="console bazaar approve"><div className="skeleton" style={{ width: 'min(100%,440px)', height: 220 }} /></div>}>
      <ApproveClient />
    </Suspense>
  );
}
