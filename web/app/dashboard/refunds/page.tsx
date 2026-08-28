import React from 'react';
import { getRefunds } from '@/lib/api';
import Link from 'next/link';

export default async function RefundsPage() {
  const refunds = await getRefunds();

  const formatCurrency = (amountMinor: number, currency: string) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
    }).format(amountMinor / 100);
  };

  return (
    <div className="refunds-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Refunds Governance Console</h1>
          <p className="page-subtitle">Provider refund state vs Kavach governance state.</p>
        </div>
      </div>

      <div className="card table-card">
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)', fontSize: '12px' }}>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>REFUND ID</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>AMOUNT</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>RAIL STATE</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>OBLIGATION</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>LAST EVENT</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}></th>
            </tr>
          </thead>
          <tbody>
            {refunds.map((refund: any) => (
              <tr key={refund.entity} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background-color 0.2s ease' }}>
                <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                  {refund.entity.replace('refund:', '')}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(refund.amount * 100, refund.currency)}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                  <span className={`status-badge status-${refund.rail_state.toLowerCase()}`}>
                    {refund.rail_state}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                  <span className={`status-badge status-${refund.obligation.toLowerCase()}`} style={refund.obligation === 'OPEN' ? { backgroundColor: 'var(--accent-blue-bg)', color: 'var(--accent-blue)' } : {}}>
                    {refund.obligation}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {refund.unresolved_for_seconds > 0 ? `${refund.unresolved_for_seconds}s ago` : 'Just now'}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <Link href={`/dashboard/refunds/${refund.entity.replace('refund:', '')}`} style={{ fontSize: '12px', color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}>
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {refunds.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  No refunds tracked.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
