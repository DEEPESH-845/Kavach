'use client';

/* Three outcomes that cannot be mistaken for each other, then the ladder, then the raw
 * admission. Simple sentence -> evidence -> technical proof, in that order. */

import { useState } from 'react';
import { ArrowRight, ChevronDown, ShieldCheck, Smartphone } from 'lucide-react';
import type { Admission, Stage } from '@/lib/api';
import { money, risk as fmtRisk } from '@/lib/format';
import { journey, useJourney } from '@/lib/journey';
import { Badge, Json, Ladder, Why } from '@/components/console/ui';

const HEADLINE: Record<string, string> = {
  ALLOW: 'Purchase authorised',
  STEP_UP: 'Priya needs to approve this',
  HOLD: 'Held for the merchant to review',
  DENY: 'Purchase blocked',
};

function plain(a: Admission, capMinor: number): string {
  const total = a.cart.total_minor;
  if (a.scope_violations.includes('PER_TXN_CAP_EXCEEDED')) {
    return `The agent tried to spend ${money(total)}. The mandate allows ${money(capMinor)} per order — ${money(total - capMinor)} over. Refused by integer arithmetic; no model was consulted.`;
  }
  if (a.scope_violations.includes('CUMULATIVE_CAP_EXCEEDED')) {
    return `This cart would take the mandate past its weekly cap. Refused by arithmetic against admissions already in the log.`;
  }
  if (a.scope_violations.includes('CATEGORY_OUT_OF_SCOPE')) {
    return `The cart holds items outside the categories Priya delegated. Under the cap, wrong shelf. Refused by scope; no model was consulted.`;
  }
  if (a.envelope_failures.length) {
    return `The delegation envelope itself was rejected: ${a.envelope_failures.join(', ')}. Nothing downstream ran.`;
  }
  const drift = a.risk_factors.some((f) => /drift|correlation/.test(f));
  if (a.verdict === 'DENY') {
    return drift
      ? `Every cap and category passed. The cart matches text the agent read on a product page more than it matches the purpose Priya wrote — the provenance plane raised the risk to ${fmtRisk(a.purpose_risk)} and the entailment model refused it.`
      : `Every cap and category passed. The entailment model read the cart against Priya's purpose and scored purpose-mismatch at ${fmtRisk(a.purpose_risk)}; refusing was the cheapest expected loss.`;
  }
  if (a.verdict === 'STEP_UP') {
    return `Every deterministic check passed, and the model is not sure this is what Priya meant (risk ${fmtRisk(a.purpose_risk)}). The cheapest honest move is to ask her — on her own device.`;
  }
  if (a.verdict === 'HOLD') {
    return `Deterministic checks passed; the model's doubt (${fmtRisk(a.purpose_risk)}) on a cart this size prices a merchant review below a re-consent prompt.`;
  }
  return `Signature, window, scope and caps all pass, and the model reads this cart as what Priya asked for (purpose-mismatch risk ${fmtRisk(a.purpose_risk)}). The mandate is charged ${money(total)}.`;
}

export function Verdict({ focus, expand }: { focus?: boolean; expand?: boolean }) {
  const j = useJourney();
  const [more, setMore] = useState(!!expand);
  const a = j.admission;
  if (!a || !j.mandate) return null;
  const cap = j.mandate.per_txn_cap_minor;
  const failedRung = a.stages.find((s) => s.state === 'FAIL' || s.state === 'FLAG');
  const seq = a.evidence_events;

  return (
    <div className="bz-stage" data-focus={focus || undefined} id="bz-verdict">
      <div className="bz-verdict" data-v={a.verdict} role="status" aria-live="polite">
        <div className="bz-vword">{a.verdict}</div>
        <div className="bz-vtext">
          <h2>{HEADLINE[a.verdict] ?? a.verdict}</h2>
          <p>{plain(a, cap)}</p>
          <div className="bz-vfacts">
            <div className="bz-vfact"><small>amount</small><b>{money(a.cart.total_minor)}</b></div>
            <div className="bz-vfact"><small>mandate cap</small><b>{money(cap)}</b></div>
            <div className="bz-vfact"><small>decided by</small><b>{failedRung ? failedRung.label : a.purpose_risk !== null ? 'entailment model' : 'arithmetic'}</b></div>
            <div className="bz-vfact"><small>evidence</small><b>{seq.length ? `seq ${seq.join(', ')}` : 'mandate signature'}</b></div>
            <div className="bz-vfact"><small>charged</small><b>{a.charged_to_mandate ? 'yes' : 'no'}</b></div>
          </div>
          <div className="bz-vacts">
            {(a.verdict === 'ALLOW' || j.phase === 'checkout') && j.phase !== 'paid' && !j.checkout ? (
              <button className="btn btn--primary" onClick={() => journey.startCheckout()}>
                <ArrowRight size={13} /> Continue to payment
              </button>
            ) : null}
            {(a.verdict === 'STEP_UP' || a.verdict === 'HOLD') && !j.stepup ? (
              <button className="btn btn--primary" onClick={() => journey.openStepUp()}>
                <Smartphone size={13} /> Ask Priya on her phone
              </button>
            ) : null}
            {a.verdict === 'DENY' ? (
              <button className="btn" onClick={() => journey.runAgent('legit')}>Let the agent try a compliant cart</button>
            ) : null}
            <button className="btn btn--ghost btn--sm" onClick={() => setMore((v) => !v)} aria-expanded={more}>
              <ChevronDown size={12} style={{ transform: more ? 'rotate(180deg)' : undefined }} /> {more ? 'Hide' : 'Show'} the ladder & proof
            </button>
          </div>
        </div>
      </div>

      {more ? (
        <div className="bz-two">
          <div className="card">
            <div className="stat__label" style={{ marginBottom: 10 }}><ShieldCheck size={13} /> Admission ladder</div>
            <Ladder rungs={a.stages as Stage[]} />
            <p className="field__hint" style={{ marginTop: 12 }}>
              <b>SKIPPED</b> means the rung was never reached. It is not a pass.
            </p>
          </div>
          <div className="stack">
            <Why
              verdict={a.verdict}
              why={a.reasons}
              risk={a.purpose_risk === null
                ? <span style={{ color: 'var(--fog2)' }}>{a.entailment_model ? 'not scored — a deterministic rule decided first' : 'no entailment model loaded; caution widened to STEP_UP'}</span>
                : <>{fmtRisk(a.purpose_risk)} purpose-mismatch probability{a.risk_factors.length ? <div className="mono" style={{ marginTop: 4, fontSize: 12, color: 'var(--fog2)' }}>{a.risk_factors.join('  ·  ')}</div> : null}</>}
              evidence={<>
                {[...a.envelope_failures, ...a.scope_violations].map((f) => <Badge key={f} tone="deny">{f}</Badge>)}
                {seq.length ? <span className="mono"> prior admissions seq {seq.join(', ')}</span> : null}
                {' '}mandate <code className="mono">{a.mandate_id ?? j.mandate.mandate_id}</code> · issuer <code className="mono">{a.issuer.key_id}</code>
              </>}
              next={a.charged_to_mandate ? 'Admitted and charged against the cumulative cap. The admission is an event in the hash chain, and checkout will carry its hash into Razorpay\'s order notes.'
                : a.verdict === 'STEP_UP' ? 'Nothing charged. If Priya approves, admission is re-run at that moment and only then is the mandate charged.'
                : 'Nothing was charged and no payment can be created for this cart.'}
            />
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--fog)' }}>Raw admission (what the tool surface returns)</summary>
              <div style={{ marginTop: 8 }}><Json value={a} max={300} /></div>
            </details>
          </div>
        </div>
      ) : null}
    </div>
  );
}
