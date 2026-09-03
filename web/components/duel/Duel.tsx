'use client';

/* Without Kavach ∥ with Kavach, on the same inputs.
 *
 * The backend runs both lanes in a sandbox and returns every step with its cumulative
 * counters. This component reveals them one at a time so the gap opens in front of the
 * judge; the numbers are never computed here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, ShieldCheck, ShieldOff, SkipForward } from 'lucide-react';
import { journeyApi } from '@/lib/api';
import type { Duel as DuelData, DuelStep } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { money } from '@/lib/format';
import { useStill } from '@/lib/motion';
import { Async, Badge, GoLink, Skeleton } from '@/components/console/ui';

const CADENCE = 1500;

function useCountUp(target: number, ms = 600): number {
  const still = useStill();
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (still) { setV(target); from.current = target; return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(a + (target - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, still]);
  return v;
}

export function Duel({ compact, autoplay = false }: { compact?: boolean; autoplay?: boolean }) {
  const data = useApi(() => journeyApi.duel(), []);
  const still = useStill();
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const total = data.data?.steps.length ?? 0;

  useEffect(() => {
    if (!playing || !total) return;
    if (still) { setShown(total); setPlaying(false); return; }
    if (shown >= total) { setPlaying(false); return; }
    const id = setTimeout(() => setShown((n) => Math.min(total, n + 1)), shown === 0 ? 300 : CADENCE);
    return () => clearTimeout(id);
  }, [playing, shown, total, still]);

  const replay = useCallback(() => { setShown(0); setPlaying(true); }, []);
  const cur = data.data && shown > 0 ? data.data.steps[shown - 1].cumulative : null;

  return (
    <div className="dl-wrap">
      {!compact ? (
        <div className="dl-head">
          <div>
            <h1>The same agent. The same seven actions. One difference.</h1>
            <p>
              Left: the governance boundary bypassed — raw entity passthrough, every action executes.
              Right: Kavach. Both lanes run in one fresh sandbox from identical inputs; the legitimate
              actions pass in both, so the gap is entirely the attacks.
            </p>
          </div>
          <Controls playing={playing} shown={shown} total={total} onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)} onStep={() => setShown((n) => Math.min(total, n + 1))} onReplay={replay} />
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <Controls playing={playing} shown={shown} total={total} onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)} onStep={() => setShown((n) => Math.min(total, n + 1))} onReplay={replay} />
        </div>
      )}

      <Async state={data} skeleton={<Skeleton rows={6} />}>
        {(d) => (
          <>
            <Board d={d} shown={shown} ungov={cur?.ungoverned_unauthorised_minor ?? 0}
              kav={cur?.kavach_unauthorised_minor ?? 0} protectedMinor={cur?.protected_minor ?? 0}
              ungovTotal={cur?.ungoverned_minor ?? 0} kavTotal={cur?.kavach_minor ?? 0} />
            <div className="dl-lanehead" aria-hidden>
              <span>the action</span>
              <span><ShieldOff size={11} /> without Kavach</span>
              <span><ShieldCheck size={11} /> with Kavach</span>
            </div>
            <div className="dl-steps">
              {d.steps.map((s, i) => <Step key={s.n} s={s} on={i < shown} />)}
            </div>
            <div className="dl-foot">
              <Badge tone="info">sandbox · epoch {d.sandbox.epoch}</Badge>
              <Badge tone={d.model_used.entailment ? 'info' : 'warn'}>entailment {d.model_used.entailment ? 'loaded' : 'absent'}</Badge>
              <Badge tone={d.model_used.duplicate_risk ? 'info' : 'warn'}>duplicate-risk {d.model_used.duplicate_risk ? 'loaded' : 'absent'}</Badge>
              <span>{d.sandbox.note}.</span>
              {!compact ? <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}><GoLink href="/shop">Be the buyer</GoLink><GoLink href="/dashboard/adversary">Eleven more attacks</GoLink></span> : null}
            </div>
          </>
        )}
      </Async>
    </div>
  );
}

function Controls({ playing, shown, total, onPlay, onPause, onStep, onReplay }: {
  playing: boolean; shown: number; total: number;
  onPlay: () => void; onPause: () => void; onStep: () => void; onReplay: () => void;
}) {
  const done = total > 0 && shown >= total;
  return (
    <div className="dl-acts" role="group" aria-label="Playback">
      {done ? (
        <button className="btn btn--primary" onClick={onReplay}><RotateCcw size={13} /> Replay</button>
      ) : playing ? (
        <button className="btn" onClick={onPause}><Pause size={13} /> Pause</button>
      ) : (
        <button className="btn btn--primary" onClick={onPlay} disabled={!total}><Play size={13} /> {shown === 0 ? 'Run the duel' : 'Resume'}</button>
      )}
      <button className="btn btn--sm" onClick={onStep} disabled={done || !total}><SkipForward size={12} /> Step</button>
      <span className="mono" style={{ alignSelf: 'center', fontSize: 11, color: 'var(--fog2)' }}>{shown}/{total}</span>
    </div>
  );
}

function Board({ d, shown, ungov, kav, protectedMinor, ungovTotal, kavTotal }: {
  d: DuelData; shown: number; ungov: number; kav: number; protectedMinor: number; ungovTotal: number; kavTotal: number;
}) {
  const a = useCountUp(ungov);
  const b = useCountUp(kav);
  const p = useCountUp(protectedMinor);
  const attacksSoFar = d.steps.slice(0, shown).filter((s) => s.attack).length;
  return (
    <div className="dl-board" aria-live="polite">
      <div className="dl-lane" data-lane="ungoverned">
        <small><ShieldOff size={11} /> without Kavach</small>
        <h2>Unauthorised money that moved</h2>
        <div className="dl-big">{money(a, { round: true })}</div>
        <div className="dl-sub">{attacksSoFar} attack{attacksSoFar === 1 ? '' : 's'} executed · <b>{money(ungovTotal, { round: true })}</b> moved in total · no authoritative proof of any of it</div>
      </div>
      <div className="dl-lane" data-lane="kavach">
        <small><ShieldCheck size={11} /> with Kavach</small>
        <h2>Unauthorised money that moved</h2>
        <div className="dl-big">{money(b, { round: true })}</div>
        <div className="dl-sub"><b>{money(p, { round: true })}</b> refused or held · <b>{money(kavTotal, { round: true })}</b> legitimately moved · every decision an event in the hash chain</div>
      </div>
    </div>
  );
}

function Step({ s, on }: { s: DuelStep; on: boolean }) {
  const allowed = s.kavach.verdict === 'ALLOW';
  const k = s.kavach;
  return (
    <div className="dl-step" data-on={on || undefined} aria-hidden={!on}>
      <div className="dl-act">
        <span className="n">{String(s.n).padStart(2, '0')} · {s.kind} · {s.attack ? 'attack' : 'legitimate'}</span>
        <h3>{s.title}</h3>
        <p>{s.question}</p>
        <span className="amt">{money(s.amount_minor)}{s.reason_text ? <span style={{ color: 'var(--fog2)' }}> · “{s.reason_text}”</span> : null}</span>
      </div>
      <div className="dl-out" data-k="exec" data-lane="without Kavach">
        <div className="v"><b>EXECUTED</b> <span style={{ color: 'var(--fog2)' }}>{money(s.ungoverned.amount_minor)}</span></div>
        <div className="why">{s.ungoverned.note}.</div>
        {s.attack ? <div className="run" style={{ color: 'var(--oxide)' }}>{money(s.amount_minor)} of unauthorised money moved</div> : <div className="run">legitimate; would have moved anyway</div>}
      </div>
      <div className="dl-out" data-k={allowed ? 'ok' : 'refused'} data-lane="with Kavach">
        <div className="v"><b>{k.verdict}</b>{k.executed_minor ? <span style={{ color: 'var(--fog2)' }}>{money(k.executed_minor)}</span> : null}
          {typeof k.purpose_risk === 'number' ? <span className="run">risk {k.purpose_risk.toFixed(2)}</span> : null}
          {typeof k.duplicate_risk === 'number' ? <span className="run">dup {k.duplicate_risk.toFixed(2)}</span> : null}
        </div>
        {k.refused_by ? <div className="by">refused by {k.refused_by}</div> : null}
        <div className="why">{k.reasons[0]}</div>
      </div>
    </div>
  );
}
