import React from 'react';
import { getIntentDetail } from '@/lib/api';
import Link from 'next/link';

export default async function IntentDetailPage({ params }: { params: { intentId: string } }) {
  const intent = await getIntentDetail(params.intentId);

  const formatCurrency = (amountMinor: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(amountMinor / 100);
  };

  const decision = intent.decision || {};

  return (
    <div className="intent-detail-page">
      <div className="breadcrumbs" style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
        <Link href="/dashboard" style={{ color: 'inherit', textDecoration: 'none' }}>Dashboard</Link>
        <span style={{ margin: '0 8px' }}>/</span>
        <Link href="/dashboard/intents" style={{ color: 'inherit', textDecoration: 'none' }}>Intents</Link>
        <span style={{ margin: '0 8px' }}>/</span>
        <span style={{ color: 'var(--text-primary)' }}>{intent.intent_id}</span>
      </div>

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Intent {intent.intent_id}</h1>
          <p className="page-subtitle">Created {new Date(intent.created_at * 1000).toLocaleString()}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ marginBottom: '8px' }}>
            <span className={`status-badge status-${intent.status.toLowerCase()}`}>
              {intent.status}
            </span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
            {formatCurrency(intent.amount_minor)}
          </div>
        </div>
      </div>

      <div className="grid-cards" style={{ marginBottom: '24px' }}>
        <div className="card">
          <h3 style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>Identity</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>AGENT</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                <Link href={`/dashboard/agents/${intent.agent_id}`} style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
                  {intent.agent_id}
                </Link>
              </div>
            </div>
            
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>SESSION</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{intent.session_id}</div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>REASON</div>
              <div style={{ fontSize: '13px', fontStyle: 'italic', color: 'var(--text-secondary)' }}>"{intent.reason_text}"</div>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>Target</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>OPERATION</div>
              <div style={{ fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{intent.tool}</div>
            </div>
            
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>TARGET ENTITY</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                <Link href={`/dashboard/${intent.target_type}s/${intent.target_id}`} style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
                  {intent.target_id}
                </Link>
                <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                  ({intent.target_type})
                </span>
              </div>
            </div>

            {intent.result_id && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>PROVIDER RESULT</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{intent.result_id}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Governor Decision</h3>
          <Link href={`/dashboard/proof/${intent.intent_id}`} style={{ fontSize: '12px', color: 'var(--accent-blue)', textDecoration: 'none' }}>
            View Proof →
          </Link>
        </div>
        
        <div style={{ padding: '16px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: '6px', fontFamily: 'var(--font-mono)', fontSize: '13px', overflowX: 'auto' }}>
          <pre style={{ margin: 0 }}>{JSON.stringify(decision, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
