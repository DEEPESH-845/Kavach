'use client';

import { BazaarTop } from '@/components/bazaar/BazaarTop';
import { Journey } from '@/components/bazaar/Journey';
import { Term } from '@/components/Term';

export function ShopClient() {
  return (
    <div className="console bazaar">
      <BazaarTop current="shop" />
      <div className="bz-wrap bz-hero">
        <div>
          <h1>Priya gave an agent her card. Kavach decides what it may do with it.</h1>
          <p>
            Priya writes down what her AI agent is allowed to buy and how much it may spend — a{' '}
            <Term k="mandate">mandate</Term> — and signs it. Then she lets it loose in a real
            shop. Pick one of the six ways it can behave below: one honest, five that a simple
            spending limit would happily wave through. Kavach decides each one in front of you
            and shows its reasoning. Payments run in Razorpay’s test mode, so no real money
            moves.
          </p>
        </div>
      </div>
      <Journey />
    </div>
  );
}
