'use client';

import { BazaarTop } from '@/components/bazaar/BazaarTop';
import { Journey } from '@/components/bazaar/Journey';

export function ShopClient() {
  return (
    <div className="console bazaar">
      <BazaarTop current="shop" />
      <div className="bz-wrap bz-hero">
        <div>
          <h1>Priya gave an agent her card. Kavach decides what it may do with it.</h1>
          <p>
            A mandate, a storefront, and a bench agent that shops within — or past — what it was
            delegated. Every verdict below is the real admission path; every payment is Razorpay
            test mode.
          </p>
        </div>
      </div>
      <Journey />
    </div>
  );
}
