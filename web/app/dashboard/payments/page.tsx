import React from 'react';
import { getPayments } from '@/lib/api';
import Link from 'next/link';

export default async function PaymentsPage() {
  const payments = await getPayments();

  const formatCurrency = (amountMinor: number, currency: string) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
    }).format(amountMinor / 100);
  };

  return (
    <div className="payments-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Financial Truth: Payments</h1>
          <p className="page-subtitle">Derived payment objects from trusted provider data.</p>
        </div>
      </div>

      <div className="card table-card">
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)', fontSize: '12px' }}>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>PAYMENT ID</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>AMOUNT</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>RAIL STATE</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>OBLIGATION</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>LAST EVENT</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment: any) => (
              <tr key={payment.entity} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background-color 0.2s ease' }}>
                <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                  {payment.entity.replace('payment:', '')}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(payment.amount * 100, payment.currency)}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                  <span className={`status-badge status-${payment.rail_state.toLowerCase()}`}>
                    {payment.rail_state}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                  <span className={`status-badge status-${payment.obligation.toLowerCase()}`} style={payment.obligation === 'OPEN' ? { backgroundColor: 'var(--accent-blue-bg)', color: 'var(--accent-blue)' } : {}}>
                    {payment.obligation}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {payment.unresolved_for_seconds > 0 ? `${payment.unresolved_for_seconds}s ago` : 'Just now'}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <Link href={`/dashboard/payments/${payment.entity.replace('payment:', '')}`} style={{ fontSize: '12px', color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}>
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  No payments tracked.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
