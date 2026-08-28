import React from 'react';
import { getApprovals } from '@/lib/api';
import Link from 'next/link';
import { Inbox, AlertTriangle, Clock, ArrowRight, ShieldAlert, Cpu } from 'lucide-react';

export default async function ApprovalsPage() {
  const approvals = await getApprovals();

  const formatCurrency = (amountMinor: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(amountMinor / 100);
  };

  return (
    <div className="approvals-page" style={{ animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) both' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <h1 className="page-title" style={{ margin: 0 }}>Approval Queue</h1>
            <span className="status-badge status-escalate">
              <Inbox size={12} /> {approvals.length} Pending
            </span>
          </div>
          <p className="page-subtitle">Intents escalated by Kavach requiring manual human governance.</p>
        </div>
      </div>

      <div className="premium-table-container" style={{ animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both' }}>
        <table className="premium-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Agent</th>
              <th>Operation</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Escalation Reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {approvals.map((intent: any, i: number) => (
              <tr key={intent.intent_id} className="table-row-hover" style={{ animation: `reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${0.2 + i * 0.05}s both` }}>
                <td style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                  <Clock size={14} style={{ color: 'var(--text-tertiary)' }} />
                  {new Date(intent.created_at * 1000).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  })}
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-primary)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Cpu size={12} style={{ color: 'var(--text-tertiary)' }} />
                    {intent.agent_id}
                  </div>
                </td>
                <td>
                  <span style={{ background: 'var(--glass-2)', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', border: '1px solid var(--border-subtle)' }}>
                    {intent.tool}
                  </span>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--text-primary)', fontWeight: 500 }}>
                  {formatCurrency(intent.amount_minor)}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--status-escalate)', fontSize: '12px', background: 'rgba(249, 115, 22, 0.1)', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(249, 115, 22, 0.2)', maxWidth: '280px' }}>
                    <ShieldAlert size={14} style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {intent.decision?.escalation_reason || intent.reason_text}
                    </span>
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/dashboard/intents/${intent.intent_id}`} style={{ 
                    display: 'inline-flex', alignItems: 'center', gap: '6px', 
                    fontSize: '12px', color: 'var(--accent-orange)', textDecoration: 'none', 
                    fontWeight: 500, padding: '4px 12px', background: 'var(--accent-orange-bg)',
                    borderRadius: '4px', border: '1px solid rgba(249, 115, 22, 0.2)'
                  }}>
                    Review <ArrowRight size={14} />
                  </Link>
                </td>
              </tr>
            ))}
            {approvals.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <AlertTriangle size={24} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                  <div>No pending approvals. Inbox zero.</div>
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
        .table-row-hover:hover {
          background-color: var(--glass-1);
          cursor: pointer;
        }
      `}} />
    </div>
  );
}
