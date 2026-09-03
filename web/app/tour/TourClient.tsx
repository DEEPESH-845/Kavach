'use client';

import { BazaarTop } from '@/components/bazaar/BazaarTop';
import { Tour } from '@/components/tour/Tour';

export function TourClient() {
  return (
    <div className="console bazaar tour">
      <BazaarTop current="tour" />
      <Tour />
    </div>
  );
}
