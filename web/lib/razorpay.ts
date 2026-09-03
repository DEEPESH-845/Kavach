'use client';

/* Razorpay Standard Checkout, loaded on demand.
 *
 * The script is Razorpay's own and only the public key ID reaches it. The handler's
 * response -- order id, payment id, signature -- goes straight back to the API, which
 * verifies the signature with the secret it alone holds. Nothing about the payment is
 * believed on this side of the wire.
 */

const SRC = 'https://checkout.razorpay.com/v1/checkout.js';

type CheckoutResponse = {
  razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string;
};

type RazorpayCtor = new (options: Record<string, unknown>) => { open: () => void };

declare global {
  interface Window { Razorpay?: RazorpayCtor }
}

let loading: Promise<void> | null = null;

export function loadCheckout(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('Razorpay Checkout could not be loaded. Check the network and retry.')); };
    document.head.appendChild(s);
  });
  return loading;
}

export async function openCheckout(opts: {
  keyId: string; orderId: string; amountMinor: number; description: string;
  notes?: Record<string, string>;
  onSuccess: (r: CheckoutResponse) => void; onDismiss: () => void;
}): Promise<void> {
  await loadCheckout();
  const Razorpay = window.Razorpay!;
  const rzp = new Razorpay({
    key: opts.keyId,
    amount: opts.amountMinor,
    currency: 'INR',
    name: 'Kavach Bazaar',
    description: opts.description,
    order_id: opts.orderId,
    notes: opts.notes ?? {},
    // Test-mode conventions: any test card, or `success@razorpay` for UPI.
    prefill: { name: 'Priya S.', email: 'priya@example.com', contact: '+919812345678' },
    readonly: { contact: true, email: true },
    theme: { color: '#e9e6de', backdrop_color: 'rgba(8,9,10,0.85)' },
    modal: { ondismiss: opts.onDismiss },
    handler: opts.onSuccess,
  });
  rzp.open();
}
