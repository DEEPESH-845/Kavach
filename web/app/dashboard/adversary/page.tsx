"use client";

import React, { useState } from 'react';
import { submitIntent } from '@/lib/api';
import Link from 'next/link';

export default function AdversaryLabPage() {
  const [formData, setFormData] = useState({
    agent_id: 'adversary_x_99',
    session_id: 'sess_attack_001',
    tool: 'refund_payment',
    target_type: 'payment',
    target_id: 'pay_NzY2MThlMm',
    amount_minor: '999999999', // Huge amount
    reason_text: 'I am bypassing the limits',
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const payload = {
        ...formData,
        amount_minor: parseInt(formData.amount_minor, 10)
      };
      const response = await submitIntent(payload);
      setResult(response);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="adversary-lab-page">
      <div className="page-header" style={{ marginBottom: '24px' }}>
        <h1 className="page-title">Adversary Lab</h1>
        <p className="page-subtitle">Security Sandbox. Write hypothetical intent payloads to test Kavach's defense layers.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        <div className="card">
          <h3 style={{ fontSize: '14px', marginBottom: '20px', fontWeight: 500, color: 'var(--status-deny)' }}>Attack Vector Configuration</h3>
          
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>AGENT IDENTITY (SPOOFED)</label>
              <input 
                type="text" 
                name="agent_id" 
                value={formData.agent_id} 
                onChange={handleChange}
                style={{ width: '100%', padding: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>OPERATION</label>
                <select 
                  name="tool" 
                  value={formData.tool} 
                  onChange={handleChange}
                  style={{ width: '100%', padding: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px' }}
                >
                  <option value="refund_payment">refund_payment</option>
                  <option value="cancel_subscription">cancel_subscription</option>
                  <option value="extract_funds">extract_funds</option>
                </select>
              </div>
              
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>AMOUNT (MINOR)</label>
                <input 
                  type="number" 
                  name="amount_minor" 
                  value={formData.amount_minor} 
                  onChange={handleChange}
                  style={{ width: '100%', padding: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '13px' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>TARGET TYPE</label>
                <input 
                  type="text" 
                  name="target_type" 
                  value={formData.target_type} 
                  onChange={handleChange}
                  style={{ width: '100%', padding: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>TARGET ID</label>
                <input 
                  type="text" 
                  name="target_id" 
                  value={formData.target_id} 
                  onChange={handleChange}
                  style={{ width: '100%', padding: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '13px' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>PROMPT INJECTION / ATTACK PAYLOAD</label>
              <textarea 
                name="reason_text" 
                value={formData.reason_text} 
                onChange={handleChange}
                rows={3}
                style={{ width: '100%', padding: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--status-deny)', fontSize: '13px', resize: 'vertical', fontFamily: 'var(--font-mono)' }}
              />
            </div>

            <button 
              type="submit" 
              disabled={loading}
              style={{ padding: '12px', backgroundColor: 'var(--status-deny)', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', marginTop: '8px' }}
            >
              {loading ? 'Executing Attack...' : 'Launch Simulated Attack'}
            </button>
          </form>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '14px', marginBottom: '20px', fontWeight: 500 }}>Defense Telemetry</h3>
          
          <div style={{ flex: 1, backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '16px', overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
            {!result && !error && (
              <span style={{ color: 'var(--text-tertiary)' }}>Awaiting attack vector submission...</span>
            )}
            
            {error && (
              <span style={{ color: 'var(--status-deny)' }}>{error}</span>
            )}
            
            {result && (
              <div>
                <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className={`status-badge status-${result.decision.status.toLowerCase()}`}>
                    {result.decision.status}
                  </span>
                  <Link href={`/dashboard/proof/${result.intent_id}`} style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontSize: '12px', fontWeight: 500 }}>
                    Audit Proof →
                  </Link>
                </div>
                
                {result.decision.status === 'BLOCKED' && (
                  <div style={{ padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', marginBottom: '16px', color: 'var(--status-deny)', fontWeight: 500 }}>
                    Attack successfully neutralized by Kavach Governance.
                  </div>
                )}
                
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)' }}>
                  {JSON.stringify(result.decision, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
