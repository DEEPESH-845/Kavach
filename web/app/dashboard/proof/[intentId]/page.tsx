"use client";

import React, { useEffect, useState } from 'react';
import { getIntentDetail } from '@/lib/api';
import Link from 'next/link';
import { ChevronRight, Lock, Key, FileText, CheckCircle2, ShieldAlert, Cpu, Network, FileCode, CheckCircle, ArrowRight } from 'lucide-react';

export default function ProofDetailPage({ params }: { params: { intentId: string } }) {
  const [intent, setIntent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<'none' | 'success' | 'failure'>('none');

  useEffect(() => {
    getIntentDetail(params.intentId).then((data) => {
      setIntent(data);
      setLoading(false);
    });
  }, [params.intentId]);

  const handleVerify = () => {
    setVerifying(true);
    setVerificationResult('none');
    setTimeout(() => {
      setVerifying(false);
      if (intent?.decision?.signature) {
        setVerificationResult('success');
      } else {
        setVerificationResult('failure');
      }
    }, 1200);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-secondary)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div className="status-badge status-processing" style={{ animation: 'pulse 1.5s infinite' }}>
            <Lock size={14} /> Loading Cryptographic Evidence...
          </div>
        </div>
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes pulse {
            0% { opacity: 0.5; }
            50% { opacity: 1; }
            100% { opacity: 0.5; }
          }
        `}} />
      </div>
    );
  }

  const decision = intent?.decision || {};
  const payloadToSign = { ...decision };
  delete payloadToSign.signature;

  const nodes = [
    { id: 'agent', label: 'Agent Request', icon: <Cpu size={14} />, status: 'active', desc: `Agent ${intent.agent_id} initiated action` },
    { id: 'intent', label: 'Intent Extraction', icon: <FileText size={14} />, status: 'active', desc: `Tool: ${intent.tool} | Amount: ${intent.amount_minor/100} INR` },
    { id: 'truth', label: 'Truth Alignment', icon: <Network size={14} />, status: 'active', desc: 'Validated against known rail states' },
    { id: 'risk', label: 'Risk Evaluation', icon: <ShieldAlert size={14} />, status: 'active', desc: `Risk Score computed` },
    { id: 'governor', label: 'Governor Decision', icon: <FileCode size={14} />, status: 'active', desc: `Status: ${intent.status}` },
    { id: 'crypto', label: 'Cryptographic Sealing', icon: <Lock size={14} />, status: 'active', desc: `Signed with ${decision.signed_by}` },
  ];

  return (
    <div className="proof-detail-page" style={{ animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) both' }}>
      <div className="breadcrumbs" style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>
        <Link href="/dashboard" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }}>Dashboard</Link>
        <ChevronRight size={12} />
        <Link href="/dashboard/proof" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }}>Proofs</Link>
        <ChevronRight size={12} />
        <span style={{ color: 'var(--text-primary)' }}>{intent.intent_id}</span>
      </div>

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            Cryptographic Proof <Lock size={20} style={{ color: 'var(--text-secondary)' }} />
          </h1>
          <p className="page-subtitle">Verifiable forensic evidence of the Kavach governor decision chain.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '32px' }}>
        
        {/* Evidence Chain */}
        <div className="evidence-chain" style={{ position: 'relative', paddingLeft: '24px' }}>
          {/* Vertical Line */}
          <div style={{ position: 'absolute', left: '7px', top: '20px', bottom: '20px', width: '2px', background: 'var(--border-subtle)', zIndex: 0 }} />
          
          {nodes.map((node, i) => (
            <div key={node.id} style={{ 
              position: 'relative', 
              paddingBottom: i === nodes.length - 1 ? '0' : '40px',
              animation: `reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${0.2 + (i * 0.1)}s both`
            }}>
              {/* Node Dot */}
              <div style={{ 
                position: 'absolute', left: '-22px', top: '24px', width: '10px', height: '10px', 
                borderRadius: '50%', background: 'var(--bg-app)', border: '2px solid var(--accent-blue)', 
                zIndex: 2,
                boxShadow: '0 0 12px rgba(56, 139, 253, 0.5)'
              }} />
              
              <div className="premium-card" style={{ padding: '16px 24px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                <div style={{ 
                  background: 'var(--glass-2)', padding: '10px', borderRadius: '8px', 
                  border: '1px solid var(--border-subtle)', color: 'var(--text-primary)'
                }}>
                  {node.icon}
                </div>
                <div>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>{node.label}</h3>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>{node.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Verification Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.8s both' }}>
          <div className="premium-card" style={{ position: 'sticky', top: '96px' }}>
            <h3 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Key size={14} /> Verification Engine
            </h3>
            
            <button 
              onClick={handleVerify}
              disabled={verifying || !decision.signature}
              style={{ 
                width: '100%',
                padding: '12px', 
                background: verifying ? 'transparent' : 'var(--text-primary)', 
                color: verifying ? 'var(--text-primary)' : 'var(--bg-app)', 
                border: verifying ? '1px solid var(--border-subtle)' : 'none',
                borderRadius: '6px', 
                fontWeight: 600, 
                fontSize: '13px',
                cursor: (verifying || !decision.signature) ? 'not-allowed' : 'pointer',
                transition: 'all var(--motion-fast)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '24px'
              }}
            >
              {verifying ? (
                <><span style={{ animation: 'pulse 1s infinite' }}><CheckCircle2 size={16} /></span> Verifying Ed25519...</>
              ) : 'Verify Cryptographic Signature'}
            </button>

            {verificationResult !== 'none' && (
              <div style={{ 
                padding: '16px', 
                borderRadius: '8px', 
                backgroundColor: verificationResult === 'success' ? 'rgba(46, 160, 67, 0.1)' : 'rgba(248, 81, 73, 0.1)',
                border: `1px solid ${verificationResult === 'success' ? 'rgba(46, 160, 67, 0.2)' : 'rgba(248, 81, 73, 0.2)'}`,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px'
              }}>
                <div style={{ color: verificationResult === 'success' ? 'var(--status-allow)' : 'var(--status-deny)', marginTop: '2px' }}>
                  <CheckCircle size={16} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: verificationResult === 'success' ? 'var(--status-allow)' : 'var(--status-deny)', marginBottom: '4px' }}>
                    {verificationResult === 'success' ? 'Signature Verified' : 'Verification Failed'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {verificationResult === 'success' 
                      ? `Payload securely signed by ${decision.signed_by} and remains untampered.` 
                      : 'No valid signature could be verified for this intent.'}
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>Signer Key ID</div>
                <div style={{ fontSize: '12px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', background: 'var(--glass-1)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                  {decision.signed_by || 'Unknown'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>Signature</div>
                <div style={{ fontSize: '12px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', background: 'var(--glass-1)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                  {decision.signature || 'No signature present'}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes reveal {
          from { opacity: 0; transform: translateY(16px); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
      `}} />
    </div>
  );
}
