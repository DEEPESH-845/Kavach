import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TourClient } from './TourClient';
import '@/app/dashboard/console.css';
import '@/app/shop/bazaar.css';
import '@/app/duel/duel.css';
import './tour.css';

export const metadata: Metadata = {
  title: 'The five-minute tour — Kavach',
  description: 'Give an agent authority, watch it overreach, watch Kavach intervene, approve on your phone, pay in test mode, inspect and tamper with the evidence.',
};

export default function TourPage() {
  return (
    <Suspense fallback={<div className="console bazaar tour"><div className="tr-wrap"><div className="skeleton" style={{ height: 300, marginTop: 30 }} /></div></div>}>
      <TourClient />
    </Suspense>
  );
}
