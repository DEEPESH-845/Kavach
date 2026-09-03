'use client';

/* The Bazaar, composed. The same component renders `/shop` and every buyer step of `/tour`;
 * `focus` draws the eye to one region and `compact` trims the grid for the tour. */

import { useEffect } from 'react';
import { journey, useJourney } from '@/lib/journey';
import { ErrorState } from '@/components/console/ui';
import { MandateCard } from './MandateCard';
import { ScenarioBar } from './ScenarioBar';
import { Storefront } from './Storefront';
import { AgentActivity } from './AgentActivity';
import { CartPanel } from './CartPanel';
import { Verdict } from './Verdict';
import { StepUpPanel } from './StepUpPanel';
import { CheckoutPanel } from './CheckoutPanel';
import { TruthPanel } from './TruthPanel';

export type Focus = 'mandate' | 'store' | 'agent' | 'cart' | 'verdict' | 'stepup' | 'checkout' | 'evidence';

export function Journey({ focus, compact, expand }: { focus?: Focus; compact?: boolean; expand?: boolean }) {
  const j = useJourney();
  useEffect(() => { void journey.load(); return () => journey.stop(); }, []);

  useEffect(() => {
    if (!focus) return;
    const id = { verdict: 'bz-verdict', stepup: 'bz-stepup', checkout: 'bz-checkout', evidence: 'bz-truth' }[focus as string];
    if (!id) return;
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  }, [focus, j.phase]);

  if (j.phase === 'error' && !j.store) {
    return <ErrorState error={j.error!} retry={() => journey.load()} />;
  }

  return (
    <div className="bz-wrap">
      <div className="bz-grid">
        <div className="bz-col bz-col--side">
          <MandateCard focus={focus === 'mandate'} />
          <ScenarioBar focus={focus === 'agent'} />
        </div>
        <div className="bz-col">
          <Storefront focus={focus === 'store'} compact={compact} />
        </div>
        <div className="bz-col bz-col--agent">
          <AgentActivity focus={focus === 'agent'} />
          <CartPanel focus={focus === 'cart'} />
        </div>
      </div>

      {j.error && j.store && j.phase !== 'checkout' ? (
        <div style={{ paddingBottom: 16 }}><ErrorState error={j.error} compact retry={() => journey.submit()} /></div>
      ) : null}

      {j.admission ? (
        <div className="bz-stage" style={{ paddingBottom: 40 }}>
          <Verdict focus={focus === 'verdict'} expand={expand} />
          {j.stepup ? <StepUpPanel focus={focus === 'stepup'} /> : null}
          {j.checkout ? <CheckoutPanel focus={focus === 'checkout'} /> : null}
          {j.checkout?.status ? <TruthPanel focus={focus === 'evidence'} /> : null}
        </div>
      ) : null}
    </div>
  );
}
