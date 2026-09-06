import type { Metadata } from 'next';
import { ShopClient } from './ShopClient';
import '@/app/dashboard/console.css';
import './bazaar.css';

export const metadata: Metadata = {
  title: 'Kavach Shop — shop through an agent, safely',
  description: 'Give an agent a mandate, watch it shop, watch Kavach decide, pay in Razorpay test mode, and inspect the evidence.',
};

export default function ShopPage() {
  return <ShopClient />;
}
