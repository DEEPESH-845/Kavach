import React from 'react';
import { getAgentDetail } from '@/lib/api';
import Link from 'next/link';

export default async function AgentDetailPage({ params }: { params: { agentId: string } }) {
  const agent = await getAgentDetail(params.agentId);

  const formatCurrency = (amountMinor: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(amountMinor / 100);
  };

  const formatPercent = (rate: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(rate);
  };

  return (
    <div className="agent-detail-page">
      <div className="breadcrumbs" style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
        <Link href="/dashboard" style={{ color: 'inherit', textDecoration: 'none' }}>Dashboard</Link>
        <span style={{ margin: '0 8px' }}>/</span>
        <Link href="/dashboard/agents" style={{ color: 'inherit', textDecoration: 'none' }}>Agents</Link>
        <span style={{ margin: '0 8px' }}>/</span>
        <span style={{ color: 'var(--text-primary)' }}>{params.agentId}</span>
      </div>

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">{params.agentId}</h1>
          <p className="page-subtitle">Agent Profile</p>
        </div>
      </div>

      <div className="grid-cards" style={{ marginBottom: '24px' }}>
        <div className="card stat-card">
          <div className="stat-label">Lifetime Volume</div>
          <div className="stat-value">{formatCurrency(agent.lifetime_volume)}</div>
        </div>

        <div className="card stat-card">
          <div className="stat-label">Total Intents</div>
          <div className="stat-value">{agent.intent_count}</div>
        </div>

        <div className="card stat-card">
          <div className="stat-label">Block Rate</div>
          <div className="stat-value" style={{ color: agent.block_rate > 0.1 ? 'var(--status-escalate)' : 'inherit' }}>
            {formatPercent(agent.block_rate)}
          </div>
        </div>
      </div>

      <div className="card table-card">
        <h3 style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', margin: '20px', letterSpacing: '0.05em' }}>Recent Activity</h3>
        
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)', fontSize: '12px' }}>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>TIMESTAMP</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>OPERATION</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>AMOUNT</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>STATUS</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}></th>
            </tr>
          </thead>
          <tbody>
            {agent.recent_intents.map((intent: any) => (
              <tr key={intent.intent_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {new Date(intent.created_at * 1000).toLocaleString()}
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
