import type { Metadata } from 'next';
import { DuelClient } from './DuelClient';
import '@/app/dashboard/console.css';
import '@/app/shop/bazaar.css';
import './duel.css';

export const metadata: Metadata = {
  title: 'The Duel — without Kavach, with Kavach',
  description: 'The same agent, the same seven actions, two lanes. Derived from one sandbox run of the real decision code.',
};

export default function DuelPage() {
  return <DuelClient />;
}
