'use client';

/* The six things the agent can be told to do. Each promises a verdict family, and the
 * promise is asserted against the trained model in tests/test_storefront.py -- so a chip
 * here can never advertise a defence the code does not perform. */

import { Bot, Play } from 'lucide-react';
import { journey, useJourney } from '@/lib/journey';

export function ScenarioBar({ focus }: { focus?: boolean }) {
  const j = useJourney();
  if (!j.store) return null;
  const busy = j.phase === 'planning' || j.phase === 'admitting' || j.phase === 'paying';

  return (
    <div className="card" data-focus={focus || undefined}>
      <div className="stat__label" style={{ marginBottom: 10 }}><Bot size={13} /> Put the agent to work</div>
      <div className="bz-scen" role="radiogroup" aria-label="Agent scenario">
        {j.store.scenarios.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={j.mode === s.id}
            aria-pressed={j.mode === s.id}
            data-attack={s.attack && s.expects[0] === 'DENY' ? '' : undefined}
            data-stepup={s.expects[0] === 'STEP_UP' ? '' : undefined}
            title={s.question}
            onClick={() => journey.setMode(s.id)} disabled={busy}>
            <i aria-hidden />
            <span>{s.label}</span>
            <small>{s.expects.join('/')}</small>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn--primary" style={{ flex: 1 }} disabled={busy || !j.mandate}
          onClick={() => journey.runAgent(j.mode)}>
          <Play size={13} /> {j.phase === 'planning' ? 'Agent is shopping…' : 'Let the agent shop'}
        </button>
      </div>
      <p className="field__hint" style={{ marginTop: 8 }}>
        {j.store.agent.note}. Or ignore it and add products yourself.
      </p>
    </div>
  );
}
