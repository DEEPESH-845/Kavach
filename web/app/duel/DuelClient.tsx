'use client';

import { BazaarTop } from '@/components/bazaar/BazaarTop';
import { Duel } from '@/components/duel/Duel';

export function DuelClient() {
  return (
    <div className="console bazaar duel">
      <BazaarTop current="duel" />
      <Duel />
    </div>
  );
}
