import React from 'react';

export default function SettingsPage() {
  return (
    <div className="settings-page">
      <div className="page-header" style={{ marginBottom: '24px' }}>
        <h1 className="page-title">Merchant Settings</h1>
        <p className="page-subtitle">Configure Kavach governance policies and cryptographic limits.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
        <div className="card">
          <h3 style={{ fontSize: '14px', marginBottom: '20px', fontWeight: 500, paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>Risk Policy Thresholds</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>MAX TRANSACTION VALUE (INR)</label>
              <input 
                type="text" 
                defaultValue="50,000" 
                disabled
                style={{ width: '100%', padding: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', opacity: 0.7 }}
              />
              <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: 'var(--text-tertiary)' }}>Intents above this value will be automatically escalated for manual review.</p>
            </div>
            
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>MAX DAILY VOLUME PER AGENT (INR)</label>
              <input 
                type="text" 
                defaultValue="5,00,000" 
                disabled
                style={{ width: '100%', padding: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', opacity: 0.7 }}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>VELOCITY LIMIT</label>
              <input 
                type="text" 
                defaultValue="10 intents / minute" 
                disabled
                style={{ width: '100%', padding: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', opacity: 0.7 }}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>DUPLICATE OBLIGATION CHECK</label>
              <select 
                disabled
                defaultValue="strict"
                style={{ width: '100%', padding: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', opacity: 0.7 }}
              >
                <option value="strict">Strict (Block if any open obligation exists)</option>
                <option value="lenient">Lenient (Escalate only)</option>
                <option value="off">Off (Not recommended)</option>
              </select>
            </div>
          </div>
        </div>
        
        <div className="card">
          <h3 style={{ fontSize: '14px', marginBottom: '20px', fontWeight: 500, paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>Cryptographic Verification</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: '13px' }}>Sign Governor Decisions</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Automatically generate Ed25519 signatures for all Kavach decisions.</div>
              </div>
              <div style={{ width: '40px', height: '20px', backgroundColor: 'var(--status-allow)', borderRadius: '10px', position: 'relative' }}>
                <div style={{ width: '16px', height: '16px', backgroundColor: 'white', borderRadius: '50%', position: 'absolute', top: '2px', right: '2px' }}></div>
              </div>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: '13px' }}>Publish to Key Transparency Log</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Publish public keys to Kavach's verifiable transparency ledger.</div>
              </div>
              <div style={{ width: '40px', height: '20px', backgroundColor: 'var(--status-allow)', borderRadius: '10px', position: 'relative' }}>
                <div style={{ width: '16px', height: '16px', backgroundColor: 'white', borderRadius: '50%', position: 'absolute', top: '2px', right: '2px' }}></div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="card">
          <h3 style={{ fontSize: '14px', marginBottom: '20px', fontWeight: 500, paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>Environment</h3>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: '13px' }}>Current Execution Mode</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Determines how Kavach interacts with provider APIs.</div>
            </div>
            <select 
              disabled
              defaultValue="replay"
              style={{ padding: '8px 12px', backgroundColor: 'var(--accent-blue-bg)', border: '1px solid rgba(0,102,255,0.2)', borderRadius: '6px', color: 'var(--accent-blue)', fontWeight: 600, fontSize: '12px' }}
            >
              <option value="replay">REPLAY (Deterministic Demo)</option>
              <option value="test">TEST (Sandbox Networks)</option>
              <option value="live">LIVE (Production)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
