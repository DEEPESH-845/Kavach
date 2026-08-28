import React from 'react';
import { getReconciliations } from '@/lib/api';
import Link from 'next/link';
import { Scale, AlertCircle, ChevronRight, Hash, Terminal as TerminalIcon } from 'lucide-react';

export default async function ReconciliationPage() {
  const reconciliations = await getReconciliations();

  const formatCurrency = (amountMinor: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  };

  return (
    <div className="reconciliation-page" style={{ animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) both' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <h1 className="page-title" style={{ margin: 0 }}>Reconciliation Queue</h1>
            <span className="status-badge" style={{ background: 'var(--status-unknown-bg)', color: 'var(--status-unknown)', border: '1px solid var(--status-unknown-border)' }}>
              <Scale size={12} /> {reconciliations.length} Pending
            </span>
          </div>
          <p className="page-subtitle">Financial discrepancies requiring operator intervention.</p>
        </div>
      </div>

      <div className="premium-table-container" style={{ animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both', background: '#0a0a0a', border: '1px solid #222' }}>
        <div style={{ padding: '16px 24px', background: '#111', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: '12px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          <TerminalIcon size={14} /> kavach-ledger-tty1
        </div>
        
        <table className="premium-table" style={{ fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr style={{ background: '#161616', borderBottom: '1px solid #333' }}>
              <th style={{ padding: '12px 24px', color: '#888', fontSize: '11px', letterSpacing: '0.05em' }}>ID / REFERENCE</th>
              <th style={{ padding: '12px 24px', color: '#888', fontSize: '11px', letterSpacing: '0.05em' }}>TARGET_ID</th>
              <th style={{ padding: '12px 24px', color: '#888', fontSize: '11px', letterSpacing: '0.05em', textAlign: 'right' }}>AMOUNT (INR)</th>
              <th style={{ padding: '12px 24px', color: '#888', fontSize: '11px', letterSpacing: '0.05em' }}>STATE_MISMATCH</th>
              <th style={{ padding: '12px 24px', color: '#888', fontSize: '11px', letterSpacing: '0.05em' }}>T_STAMP</th>
              <th style={{ padding: '12px 24px' }}></th>
            </tr>
          </thead>
          <tbody>
            {reconciliations.map((intent: any, i: number) => (
              <tr key={intent.intent_id} style={{ 
                borderBottom: '1px solid #222', 
                background: i % 2 === 0 ? 'transparent' : '#111',
                animation: `reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${0.2 + i * 0.05}s both`
              }}>
                <td style={{ padding: '16px 24px', fontSize: '13px', color: '#eee', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Hash size={12} style={{ color: '#555' }} />
                  {intent.intent_id.substring(0, 12)}
                </td>
                <td style={{ padding: '16px 24px', fontSize: '13px', color: '#aaa' }}>
                  {intent.target_id}
                </td>
                <td style={{ padding: '16px 24px', fontSize: '13px', color: '#eee', textAlign: 'right' }}>
                  {formatCurrency(intent.amount_minor)}
                </td>
                <td style={{ padding: '16px 24px', fontSize: '13px' }}>
                  <span style={{ 
                    color: '#eab308', 
                    background: 'rgba(234, 179, 8, 0.1)', 
                    border: '1px solid rgba(234, 179, 8, 0.2)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px'
                  }}>
                    {intent.status}
                  </span>
                </td>
                <td style={{ padding: '16px 24px', fontSize: '12px', color: '#666' }}>
                  {new Date(intent.created_at * 1000).toISOString().replace('T', ' ').substring(0, 19)}
                </td>
                <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                  <Link href={`/dashboard/intents/${intent.intent_id}`} style={{ 
                    display: 'inline-flex', alignItems: 'center', gap: '4px', 
                    fontSize: '11px', color: '#00ff00', textDecoration: 'none', 
                    fontWeight: 600, padding: '4px 12px', background: 'rgba(0, 255, 0, 0.1)',
                    borderRadius: '2px', border: '1px solid rgba(0, 255, 0, 0.3)',
                    textTransform: 'uppercase', letterSpacing: '0.05em'
                  }}>
                    > ./reconcile <ChevronRight size={12} />
                  </Link>
                </td>
              </tr>
            ))}
            {reconciliations.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '64px 0', textAlign: 'center', color: '#555', fontSize: '13px' }}>
                  <AlertCircle size={24} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                  <div>LEDGER BALANCED. NO DISCREPANCIES DETECTED.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes reveal {
          from { opacity: 0; transform: translateY(12px); filter: blur(2px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
      `}} />
    </div>
  );
}
