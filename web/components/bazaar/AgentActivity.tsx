'use client';

/* The agent, visible. Every row is something the backend returned or an action the judge
 * took; nothing is typed out on a timer to look like thought. */

import { useEffect, useRef } from 'react';
import { Bot } from 'lucide-react';
import { useJourney } from '@/lib/journey';

const STATUS: Record<string, { label: string; attr: 'live' | 'busy' | 'halt' | 'idle' }> = {
  loading: { label: 'connecting', attr: 'idle' },
  idle: { label: 'ready', attr: 'live' },
  planning: { label: 'shopping', attr: 'busy' },
  admitting: { label: 'awaiting Kavach', attr: 'busy' },
  decided: { label: 'decided', attr: 'live' },
  stepup: { label: 'waiting for Priya', attr: 'busy' },
  checkout: { label: 'ready to pay', attr: 'live' },
  paying: { label: 'paying', attr: 'busy' },
  paid: { label: 'paid', attr: 'live' },
  error: { label: 'error', attr: 'halt' },
};

export function AgentActivity({ focus }: { focus?: boolean }) {
  const j = useJourney();
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [j.activity.length]);

  const s = STATUS[j.phase] ?? STATUS.idle;
  return (
    <div className="card" data-focus={focus || undefined}>
      <div className="bz-agent-head">
        <span className="bz-dot" data-live={s.attr === 'live' || undefined} data-busy={s.attr === 'busy' || undefined}
          data-halt={s.attr === 'halt' || undefined} aria-hidden />
        <span className="stat__label" style={{ margin: 0 }}><Bot size={13} /> {j.store?.agent.name ?? 'agent'}</span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fog2)' }}>{s.label}</span>
      </div>
      {j.activity.length === 0 ? (
        <p className="field__hint">Nothing yet. Choose a scenario and let the agent shop, or add products yourself.</p>
      ) : (
        <ul className="bz-activity" ref={ref} aria-live="polite" aria-label="Agent activity">
          {j.activity.map((a) => (
            <li key={a.id} data-k={a.kind}>
              <i aria-hidden />
              <div>
                {a.text}
                <time dateTime={new Date(a.at).toISOString()}>
                  {new Date(a.at).toLocaleTimeString('en-IN', { hour12: false })} · {a.kind}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
