import React from 'react';

export default function IntegrationsPage() {
  return (
    <div className="integrations-page">
      <div className="page-header" style={{ marginBottom: '24px' }}>
        <h1 className="page-title">Integrations & Data Sources</h1>
        <p className="page-subtitle">Configure provider connections and agentic interfaces.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', border: '1px solid var(--border-subtle)' }}>
              💳
            </div>
            <div>
              <h3 style={{ fontSize: '16px', margin: '0 0 4px 0', fontWeight: 500 }}>Razorpay</h3>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>Payment Gateway & Financial Truth Source</p>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              <span className="status-badge status-allow">CONNECTED</span>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>MODE: REPLAY (DEMO)</span>
            </div>
            <button style={{ padding: '8px 16px', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', cursor: 'pointer' }}>
              Configure
            </button>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', border: '1px solid var(--border-subtle)' }}>
              🤖
            </div>
            <div>
              <h3 style={{ fontSize: '16px', margin: '0 0 4px 0', fontWeight: 500 }}>Anthropic MCP Server</h3>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>Model Context Protocol integration for Claude</p>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              <span className="status-badge status-allow">LISTENING</span>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>PORT: 8000</span>
            </div>
            <button style={{ padding: '8px 16px', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', cursor: 'pointer' }}>
              Configure
            </button>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', border: '1px solid var(--border-subtle)' }}>
              🏦
            </div>
            <div>
              <h3 style={{ fontSize: '16px', margin: '0 0 4px 0', fontWeight: 500 }}>Stripe</h3>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>Payment Gateway (Coming Soon)</p>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <button style={{ padding: '8px 16px', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', cursor: 'not-allowed' }}>
              Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
