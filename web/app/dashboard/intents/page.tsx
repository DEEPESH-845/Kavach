import React from 'react';
import { getIntents } from '@/lib/api';
import Link from 'next/link';

export default async function IntentsPage() {
  const intents = await getIntents();

  const formatCurrency = (amountMinor: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(amountMinor / 100);
  };

  return (
    <div className="intents-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Live Activity Stream</h1>
          <p className="page-subtitle">Chronological agent intent actions.</p>
        </div>
        <div className="header-actions">
          <button className="icon-btn" style={{ padding: '8px 16px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)' }}>
            Filter
          </button>
        </div>
      </div>

      <div className="card table-card">
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)', fontSize: '12px' }}>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>TIMESTAMP</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>AGENT</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>OPERATION</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>AMOUNT</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>STATUS</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}></th>
            </tr>
          </thead>
          <tbody>
            {intents.map((intent: any) => (
              <tr key={intent.intent_id} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background-color 0.2s ease' }} className="table-row-hover">
                <td style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {new Date(intent.created_at * 1000).toLocaleString()}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                  {intent.agent_id}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                  {intent.tool}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(intent.amount_minor)}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                  <span className={`status-badge status-${intent.status.toLowerCase()}`}>
                    {intent.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <Link href={`/dashboard/intents/${intent.intent_id}`} style={{ fontSize: '12px', color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}>
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {intents.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  No intents found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
