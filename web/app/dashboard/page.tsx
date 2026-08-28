import React from 'react';
import { getDashboardOverview, getDashboardActivity } from '@/lib/api';
import Link from 'next/link';
import { ShieldCheck, AlertTriangle, HelpCircle, Shield, ArrowRight } from 'lucide-react';

export default async function DashboardPage() {
  const [overview, activity] = await Promise.all([
    getDashboardOverview(),
    getDashboardActivity(),
  ]);

  const formatCurrency = (amountMinor: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(amountMinor / 100);
  };

  return (
    <div className="dashboard-overview" style={{ animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) both' }}>
      
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <h1 className="page-title" style={{ margin: 0 }}>Command Center</h1>
            <span className="status-badge status-allow" style={{ fontSize: '10px' }}>Protection Active</span>
          </div>
          <p className="page-subtitle">Kavach is monitoring and governing your agentic commerce.</p>
        </div>
      </div>

      <div className="grid-cards" style={{ marginBottom: '40px', animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both' }}>
        <div className="premium-card" style={{ position: 'relative', overflow: 'hidden' }}>
          <div className="metric-label" title="Total value of financially unresolved obligations currently tracked by Kavach.">
            <ShieldCheck size={16} style={{ color: 'var(--text-tertiary)' }} />
            Open Financial Exposure
          </div>
          <div className="metric-value">{formatCurrency(overview.open_exposure)}</div>
          <div className="metric-trend">Currently tracked unresolved obligations</div>
          {/* Subtle Sparkline Background */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40px', opacity: 0.2, pointerEvents: 'none' }}>
            <svg width="100%" height="100%" viewBox="0 0 200 40" preserveAspectRatio="none">
              <path d="M0,40 L0,30 C20,30 40,10 60,15 C80,20 100,5 120,10 C140,15 160,35 180,25 C190,20 200,10 200,10 L200,40 Z" fill="url(#grad1)" />
              <path d="M0,30 C20,30 40,10 60,15 C80,20 100,5 120,10 C140,15 160,35 180,25 C190,20 200,10 200,10" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" />
              <defs>
                <linearGradient id="grad1" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="var(--text-primary)" stopOpacity="1" />
                  <stop offset="100%" stopColor="var(--text-primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>

        <div className="premium-card">
          <div className="metric-label">
            <AlertTriangle size={16} style={{ color: 'var(--status-escalate)' }} />
            Escalated Actions
          </div>
          <div className="metric-value" style={{ color: 'var(--status-escalate)' }}>
            {overview.escalated_actions}
          </div>
          <div className="metric-trend">Requires manual operator review</div>
        </div>

        <div className="premium-card">
          <div className="metric-label">
            <HelpCircle size={16} style={{ color: 'var(--status-unknown)' }} />
            Unknown Outcomes
          </div>
          <div className="metric-value" style={{ color: 'var(--status-unknown)' }}>
            {overview.unknown_outcomes}
          </div>
          <div className="metric-trend">Awaiting provider reconciliation</div>
        </div>

        <div className="premium-card" style={{ position: 'relative', overflow: 'hidden' }}>
          <div className="metric-label" title="Amount associated with intents that Kavach prevented or escalated because of duplicate-obligation risk.">
            <Shield size={16} style={{ color: 'var(--status-allow)' }} />
            Protected Amount
          </div>
          <div className="metric-value" style={{ color: 'var(--status-allow)' }}>
            {formatCurrency(overview.protected_amount)}
          </div>
          <div className="metric-trend">Prevented via duplicate-obligation risk</div>
          {/* Subtle Sparkline Background */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40px', opacity: 0.15, pointerEvents: 'none' }}>
            <svg width="100%" height="100%" viewBox="0 0 200 40" preserveAspectRatio="none">
              <path d="M0,40 L0,35 C30,35 50,25 70,25 C90,25 110,15 130,20 C160,25 180,5 200,5 L200,40 Z" fill="url(#grad2)" />
              <path d="M0,35 C30,35 50,25 70,25 C90,25 110,15 130,20 C160,25 180,5 200,5" fill="none" stroke="var(--status-allow)" strokeWidth="1.5" />
              <defs>
                <linearGradient id="grad2" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="var(--status-allow)" stopOpacity="1" />
                  <stop offset="100%" stopColor="var(--status-allow)" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>

      <div className="premium-table-container" style={{ animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both' }}>
        <div style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)' }}>
          <h2 style={{ fontSize: '15px', margin: 0, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            Live Activity Stream
          </h2>
          <Link href="/dashboard/intents" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 500 }}>
            View All Intents <ArrowRight size={14} />
          </Link>
        </div>
        
        <table className="premium-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Agent ID</th>
              <th>Operation</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((intent: any) => (
              <tr key={intent.intent_id}>
                <td style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {new Date(intent.created_at * 1000).toLocaleTimeString()}
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                  {intent.agent_id}
                </td>
                <td>
                  <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>
                    {intent.tool}
                  </span>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--text-primary)' }}>
                  {formatCurrency(intent.amount_minor)}
                </td>
                <td>
                  <span className={`status-badge status-${intent.status.toLowerCase()}`}>
                    {intent.status}
                  </span>
                </td>
              </tr>
            ))}
            {activity.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  No recent activity found. All quiet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes reveal {
          from { opacity: 0; transform: translateY(20px); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
      `}} />
    </div>
  );
}
