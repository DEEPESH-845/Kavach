import { Smooth } from '@/components/Smooth';
import { Chrome } from '@/components/Chrome';
import { Hero } from '@/components/Hero';
import { Divergence } from '@/components/Divergence';
import { Stage } from '@/components/Stage';
import { Planes } from '@/components/Planes';
import { Authority } from '@/components/Authority';
import { Stream } from '@/components/Stream';
import { ExpectedLoss } from '@/components/ExpectedLoss';
import { Evidence } from '@/components/Evidence';
import { Proof, Foot } from '@/components/Proof';

/* WORLD → PROBLEM → PRESSURE → REALISATION → SYSTEM → AUTHORITY → OUTCOME → PROOF.
   Sections 03-05 live inside one sticky stage so the visual state persists across them. */
const SECTIONS = [
  { id: 'counter', n: '01', name: 'THE COUNTER' },
  { id: 'divergence', n: '02', name: 'DIVERGENCE' },
  { id: 'gradient', n: '05', name: 'THE GRADIENT' },
  { id: 'authority', n: '06', name: 'AUTHORITY' },
  { id: 'evidence', n: '07', name: 'EVIDENCE' },
  { id: 'proof', n: '08', name: 'PROOF' },
];

export default function Page() {
  return (
    <>
      <Smooth />
      <Chrome sections={SECTIONS} />
      <main>
        <Hero />
        <Divergence />
        <Stage />
        <Planes />
        <section className="sec" id="authority">
          <div className="wrap">
            <Authority />
            <Stream />
            <ExpectedLoss />
          </div>
        </section>
        <Evidence />
        <Proof />
        <div style={{ textAlign: 'center', padding: '64px 0', borderTop: '1px solid var(--border-subtle)', marginTop: '64px' }}>
          <a href="/dashboard" style={{
            display: 'inline-block',
            padding: '16px 32px',
            backgroundColor: 'var(--accent-blue)',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '6px',
            fontWeight: 600,
            fontSize: '16px',
            letterSpacing: '0.05em'
          }}>ENTER KAVACH DASHBOARD →</a>
        </div>
      </main>
      <Foot />
    </>
  );
}
