import React from 'react';
import { getObligations } from '@/lib/api';
import Link from 'next/link';

export default async function ObligationsPage() {
  const obligations = await getObligations();

  const formatCurrency = (amountMinor: number, currency: string) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
    }).format(amountMinor / 100);
  };

  return (
    <div className="obligations-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Obligation Ledger</h1>
          <p className="page-subtitle">Kavach tracks what money is still financially unresolved.</p>
        </div>
      </div>

      <div className="card table-card">
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)', fontSize: '12px' }}>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>ENTITY</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>AMOUNT</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>OBLIGATION STATE</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>AGE</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>REASON</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}></th>
            </tr>
          </thead>
          <tbody>
            {obligations.map((obs: any) => {
              const [type, id] = obs.entity.split(':');
              return (
                <tr key={obs.entity} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background-color 0.2s ease' }}>
                  <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                    <Link href={`/dashboard/${type}s/${id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                      {id}
                    </Link>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginTop: '4px' }}>
                      {type}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                    {formatCurrency(obs.amount * 100, obs.currency)}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                    <span className={`status-badge status-${obs.obligation.toLowerCase()}`} style={obs.obligation === 'OPEN' ? { backgroundColor: 'var(--accent-blue-bg)', color: 'var(--accent-blue)' } : {}}>
                      {obs.obligation}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {obs.unresolved_for_seconds > 0 ? `${obs.unresolved_for_seconds}s` : '0s'}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {obs.because}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <Link href={`/dashboard/${type}s/${id}`} style={{ fontSize: '12px', color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}>
                      View
                    </Link>
                  </td>
                </tr>
              );
            })}
            {obligations.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  No open obligations.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
