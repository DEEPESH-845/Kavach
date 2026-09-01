import { Smooth } from '@/components/Smooth';
import { Chrome } from '@/components/Chrome';
import { Hero } from '@/components/Hero';
import { Divergence } from '@/components/Divergence';
import { Stage } from '@/components/Stage';
import { Planes } from '@/components/Planes';
import { Governor } from '@/components/Governor';
import { Authority } from '@/components/Authority';
import { Stream } from '@/components/Stream';
import { ExpectedLoss } from '@/components/ExpectedLoss';
import { Execution, Reconcile } from '@/components/Execution';
import { Evidence } from '@/components/Evidence';
import { Proof, Foot } from '@/components/Proof';
import { Handoff } from '@/components/Handoff';
import type { Metadata } from 'next';

/* This page is a server component -- everything below it is a client island, but the
   module itself is not -- so it can name itself the ordinary way. The root layout
   deliberately does not, so that the console can name its own routes. */
export const metadata: Metadata = {
  title: 'Kavach — the seam between what a rail says and what is owed',
};

/* ONE TRANSACTION, END TO END.
 *
 * The page follows a single ₹5,000 refund against pay_Nx3f9K2 from the moment an agent
 * forms the intent to the moment the whole journey is provable, and the chapter order
 * is the system's own order:
 *
 *   the world it happens in   → 01 the counter
 *   what the agent claims     → 02 intent
 *   why every existing control misses it → 03 pressure · refusal · the fix
 *   the architecture that catches it     → 04 the gradient
 *   the decision              → 05 governor
 *   the action                → 06 execution
 *   the observed outcome      → 07 reconciliation
 *   the same thing at volume, measured   → 08 evidence
 *   all of it, provable       → 09 proof
 *   somewhere to go and check → 10 enter
 *
 * Chapters 01-04 argue. 05-07 execute. 08-09 check. The half from 05 onward is the half
 * this page used to skip: it decided, and then cut to a benchmark table, which left the
 * one thing a merchant actually has to trust — what happens after ALLOW — undrawn.
 *
 * Chapter 05 is cinematic and chapter 05's second half is an instrument you can drag,
 * in that order deliberately. The claim is made at full volume and then handed to the
 * reader to falsify, which is the only sequence that survives a sceptic.
 */
export default function Page() {
  return (
    <>
      <Smooth />
      <Chrome />
      <main>
        <Hero />
        <Divergence />
        <Stage />
        <Planes />
        <Governor />
        <section className="sec" id="authority">
          <div className="wrap">
            <Authority />
            <Stream />
            <ExpectedLoss />
          </div>
        </section>
        <Execution />
        <Reconcile />
        <Evidence />
        <Proof />
        <Handoff />
      </main>
      <Foot />
    </>
  );
}
