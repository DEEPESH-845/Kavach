import React from 'react';
import { getRefundDetail } from '@/lib/api';
import Link from 'next/link';

export default async function RefundDetailPage({ params }: { params: { refundId: string } }) {
  const refund = await getRefundDetail(params.refundId);

  const formatCurrency = (amountMinor: number, currency: string) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
    }).format(amountMinor / 100);
  };

  return (
    <div className="refund-detail-page">
      <div className="breadcrumbs" style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
        <Link href="/dashboard" style={{ color: 'inherit', textDecoration: 'none' }}>Dashboard</Link>
        <span style={{ margin: '0 8px' }}>/</span>
        <Link href="/dashboard/refunds" style={{ color: 'inherit', textDecoration: 'none' }}>Refunds</Link>
        <span style={{ margin: '0 8px' }}>/</span>
        <span style={{ color: 'var(--text-primary)' }}>{params.refundId}</span>
      </div>

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Refund {params.refundId}</h1>
          <p className="page-subtitle">Derived Financial Truth</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ marginBottom: '8px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <span className={`status-badge status-${refund.rail_state.toLowerCase()}`} title="Rail State">
              {refund.rail_state}
            </span>
            <span className={`status-badge status-${refund.obligation.toLowerCase()}`} title="Obligation State" style={refund.obligation === 'OPEN' ? { backgroundColor: 'var(--accent-blue-bg)', color: 'var(--accent-blue)' } : {}}>
              OBLIGATION: {refund.obligation}
            </span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
            {formatCurrency(refund.amount * 100, refund.currency)}
          </div>
        </div>
      </div>

      <div className="grid-cards" style={{ marginBottom: '24px' }}>
        <div className="card">
          <h3 style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>Truth Evaluation</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>CONFIDENCE</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{refund.confidence}</div>
            </div>
            
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>REASON</div>
              <div style={{ fontSize: '13px', fontStyle: 'italic', color: 'var(--text-secondary)' }}>"{refund.because}"</div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>SETTLED TO CUSTOMER</div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: refund.settled_to_customer ? 'var(--status-allow)' : 'var(--status-escalate)' }}>
                {refund.settled_to_customer ? 'YES' : 'NO (Funds in flight)'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card table-card" style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', margin: '20px', letterSpacing: '0.05em' }}>Event Evidence Timeline</h3>
        
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)', fontSize: '12px' }}>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>SEQ</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>TIME</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>EVENT TYPE</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>SOURCE</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>SIGNATURE VERIFIED</th>
            </tr>
          </thead>
          <tbody>
            {refund.timeline.map((event: any) => (
              <tr key={event.seq} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{event.seq}</td>
                <td style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {new Date(event.occurred_at * 1000).toLocaleString()}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{event.event_type}</td>
                <td style={{ padding: '12px 16px', fontSize: '13px' }}>{event.source}</td>
                <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                  {event.sig_verified ? (
                    <span style={{ color: 'var(--status-allow)' }}>Yes</span>
                  ) : (
                    <span style={{ color: 'var(--status-escalate)' }}>No (Polling/Internal)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
