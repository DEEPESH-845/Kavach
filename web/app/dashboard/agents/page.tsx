import React from 'react';
import { getAgents } from '@/lib/api';
import Link from 'next/link';

export default async function AgentsPage() {
  const agents = await getAgents();

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
    <div className="agents-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Agent Registry</h1>
          <p className="page-subtitle">Entities permitted to interact with the merchant via the Gate.</p>
        </div>
      </div>

      <div className="card table-card">
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)', fontSize: '12px' }}>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>AGENT ID</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>LIFETIME VOLUME</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>TOTAL INTENTS</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>BLOCK RATE</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>LAST SEEN</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent: any) => (
              <tr key={agent.agent_id} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background-color 0.2s ease' }}>
                <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                  {agent.agent_id}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(agent.lifetime_volume)}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                  {agent.intent_count}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                  <span style={{ color: agent.block_rate > 0.1 ? 'var(--status-escalate)' : 'var(--text-primary)' }}>
                    {formatPercent(agent.block_rate)}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {new Date(agent.last_seen * 1000).toLocaleString()}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <Link href={`/dashboard/agents/${agent.agent_id}`} style={{ fontSize: '12px', color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}>
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {agents.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  No agents found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
