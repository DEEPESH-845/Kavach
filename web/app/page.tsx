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
import { Handoff } from '@/components/Handoff';

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
        <Handoff />
      </main>
      <Foot />
    </>
  );
}
