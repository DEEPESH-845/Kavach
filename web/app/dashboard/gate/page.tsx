"use client";

import React, { useState, useEffect } from 'react';
import { submitIntent } from '@/lib/api';
import Link from 'next/link';
import { ShieldCheck, ArrowRight, ShieldAlert, CheckCircle, XCircle, Loader2, Key, Terminal, Code, Fingerprint, FileText, BrainCircuit } from 'lucide-react';

export default function GateTestPage() {
  const [formData, setFormData] = useState({
    agent_id: 'agent_test_7f8a9b',
    session_id: 'sess_live_123',
    tool: 'refund_payment',
    target_type: 'payment',
    target_id: 'pay_NzY2MThlMm',
    amount_minor: '150000',
    reason_text: 'Customer requested refund due to late delivery.',
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [simSteps, setSimSteps] = useState<number>(-1);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setSimSteps(-1);

    try {
      const payload = { ...formData, amount_minor: parseInt(formData.amount_minor, 10) };
      const response = await submitIntent(payload);
      setResult(response);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Simulate sequential checkpoint reveals when result arrives
  useEffect(() => {
    if (result || error) {
      const interval = setInterval(() => {
        setSimSteps(prev => {
          if (prev >= 7) {
            clearInterval(interval);
            return prev;
          }
          return prev + 1;
        });
      }, 400);
      return () => clearInterval(interval);
    }
  }, [result, error]);

  const checkpointSteps = [
    { id: 'mandate', label: 'Mandate Check', icon: <FileText size={14}/> },
    { id: 'signature', label: 'Signature Verify', icon: <Fingerprint size={14}/> },
    { id: 'issuer', label: 'Issuer Identity', icon: <Key size={14}/> },
    { id: 'scope', label: 'Scope Boundary', icon: <Terminal size={14}/> },
    { id: 'cap', label: 'Financial Cap', icon: <Code size={14}/> },
    { id: 'semantic', label: 'Semantic Purpose', icon: <BrainCircuit size={14}/> },
    { id: 'governor', label: 'Governor Eval', icon: <ShieldCheck size={14}/> },
    { id: 'admission', label: 'Gate Admission', icon: <ArrowRight size={14}/> },
  ];

  return (
    <div className="gate-test-page" style={{ animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) both' }}>
      <div className="page-header" style={{ marginBottom: '32px' }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          Inbound Gate <ShieldCheck size={24} style={{ color: 'var(--text-secondary)' }} />
        </h1>
        <p className="page-subtitle">Security checkpoint simulator for agentic intents.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '32px' }}>
        
        {/* Form Column */}
        <div className="premium-card">
          <h3 style={{ fontSize: '13px', marginBottom: '24px', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Construct Intent Payload
          </h3>
          
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Agent ID</label>
              <input 
                type="text" name="agent_id" value={formData.agent_id} onChange={handleChange}
                style={{ width: '100%', padding: '12px', background: 'var(--glass-1)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '13px', outline: 'none', transition: 'border-color var(--motion-fast)' }}
                onFocus={(e) => e.target.style.borderColor = 'var(--border-focus)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-subtle)'}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Operation</label>
                <select 
                  name="tool" value={formData.tool} onChange={handleChange}
                  style={{ width: '100%', padding: '12px', background: 'var(--glass-1)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                >
                  <option value="refund_payment">refund_payment</option>
                  <option value="cancel_subscription">cancel_subscription</option>
                  <option value="apply_discount">apply_discount</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Amount (Minor)</label>
                <input 
                  type="number" name="amount_minor" value={formData.amount_minor} onChange={handleChange}
                  style={{ width: '100%', padding: '12px', background: 'var(--glass-1)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '13px', outline: 'none' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target Type</label>
                <input 
                  type="text" name="target_type" value={formData.target_type} onChange={handleChange}
                  style={{ width: '100%', padding: '12px', background: 'var(--glass-1)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target ID</label>
                <input 
                  type="text" name="target_id" value={formData.target_id} onChange={handleChange}
                  style={{ width: '100%', padding: '12px', background: 'var(--glass-1)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '13px', outline: 'none' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reason</label>
              <textarea 
                name="reason_text" value={formData.reason_text} onChange={handleChange} rows={3}
                style={{ width: '100%', padding: '12px', background: 'var(--glass-1)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', resize: 'vertical', outline: 'none' }}
              />
            </div>

            <button 
              type="submit" disabled={loading}
              style={{ padding: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', background: loading ? 'var(--glass-2)' : 'var(--text-primary)', color: loading ? 'var(--text-secondary)' : 'var(--bg-app)', border: 'none', borderRadius: '6px', fontWeight: 600, fontSize: '13px', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '8px', transition: 'all var(--motion-fast)' }}
            >
              {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Evaluating...</> : 'Send Intent to Gate'}
            </button>
          </form>
        </div>

        {/* Evaluation Column */}
        <div className="premium-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '13px', marginBottom: '24px', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Checkpoint Evaluation
          </h3>
          
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {(!result && !error && !loading) && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)', border: '1px dashed var(--border-subtle)', borderRadius: '8px' }}>
                Awaiting intent submission...
              </div>
            )}
            
            {(loading || simSteps >= 0) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', position: 'relative' }}>
                {checkpointSteps.map((step, idx) => {
                  const isActive = simSteps === idx;
                  const isDone = simSteps > idx;
                  const isFinalFail = (error || (result && result.decision.status !== 'ALLOW')) && idx === 7;
                  
                  if (simSteps < idx && !loading) return null; // hide future steps
                  
                  return (
                    <div key={step.id} style={{ 
                      display: 'flex', alignItems: 'center', gap: '16px', 
                      padding: '12px 16px', background: isActive ? 'var(--glass-2)' : (isDone ? 'transparent' : 'transparent'),
                      border: `1px solid ${isActive ? 'var(--border-focus)' : 'transparent'}`,
                      borderRadius: '8px',
                      opacity: (simSteps < idx) ? 0.3 : 1,
                      transition: 'all 0.3s ease'
                    }}>
                      <div style={{ 
                        color: isFinalFail ? 'var(--status-deny)' : (isDone ? 'var(--status-allow)' : 'var(--text-secondary)'),
                        animation: isActive ? 'pulse 1.5s infinite' : 'none'
                      }}>
                        {isFinalFail ? <XCircle size={18} /> : (isDone ? <CheckCircle size={18} /> : step.icon)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{step.label}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {isFinalFail ? 'Check failed' : (isDone ? 'Verified cryptographically' : (isActive ? 'Evaluating...' : 'Pending'))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {simSteps >= 7 && result && (
              <div style={{ marginTop: 'auto', paddingTop: '24px', borderTop: '1px solid var(--border-subtle)', animation: 'reveal 0.4s ease both' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <span className={`status-badge status-${result.decision.status.toLowerCase()}`}>
                    {result.decision.status}
                  </span>
                  <Link href={`/dashboard/proof/${result.intent_id}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-blue)', textDecoration: 'none', fontSize: '12px', fontWeight: 500 }}>
                    View Cryptographic Proof <ArrowRight size={12} />
                  </Link>
                </div>
                <div style={{ background: 'var(--bg-app)', padding: '16px', borderRadius: '6px', border: '1px solid var(--border-subtle)', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)', overflowX: 'auto' }}>
                  <pre style={{ margin: 0 }}>{JSON.stringify(result.decision, null, 2)}</pre>
                </div>
              </div>
            )}
            
            {simSteps >= 7 && error && (
              <div style={{ marginTop: 'auto', paddingTop: '24px', borderTop: '1px solid var(--border-subtle)', color: 'var(--status-deny)', fontSize: '13px' }}>
                <ShieldAlert size={16} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '6px' }} />
                Gate Rejected: {error}
              </div>
            )}
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes reveal {
          from { opacity: 0; transform: translateY(16px); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0% { opacity: 0.5; }
          50% { opacity: 1; }
          100% { opacity: 0.5; }
        }
      `}} />
    </div>
  );
}
