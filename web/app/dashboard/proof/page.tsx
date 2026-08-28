import React from 'react';
import { getProofs } from '@/lib/api';
import Link from 'next/link';
import { Search, Fingerprint, Activity, TerminalSquare, ArrowRight } from 'lucide-react';

export default async function ProofsPage() {
  const proofs = await getProofs();

  return (
    <div className="proofs-page" style={{ animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) both' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <h1 className="page-title" style={{ margin: 0 }}>Proof Explorer</h1>
            <span className="status-badge" style={{ background: 'var(--glass-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              <TerminalSquare size={12} /> Forensic Mode
            </span>
          </div>
          <p className="page-subtitle">Cryptographically verifiable evidence of Kavach governance.</p>
        </div>
      </div>

      <div className="premium-table-container" style={{ animation: 'reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both' }}>
        <table className="premium-table">
          <thead>
            <tr>
              <th>Intent ID</th>
              <th>Timestamp</th>
              <th>Status</th>
              <th>Signer Key</th>
              <th>Signature Trunc.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {proofs.map((proof: any, i: number) => (
              <tr key={proof.intent_id} style={{ animation: `reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${0.2 + i * 0.05}s both` }}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Fingerprint size={14} style={{ color: 'var(--text-tertiary)' }} />
                  {proof.intent_id.substring(0, 16)}...
                </td>
                <td style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {new Date(proof.created_at * 1000).toLocaleString()}
                </td>
                <td>
                  <span className={`status-badge status-${proof.status.toLowerCase()}`}>
                    {proof.status}
                  </span>
                </td>
                <td style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  {proof.signed_by}
                </td>
                <td style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                  {proof.signature.substring(0, 16)}...
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/dashboard/proof/${proof.intent_id}`} style={{ 
                    display: 'inline-flex', alignItems: 'center', gap: '6px', 
                    fontSize: '12px', color: 'var(--accent-blue)', textDecoration: 'none', 
                    fontWeight: 500, padding: '4px 12px', background: 'var(--accent-blue-bg)',
                    borderRadius: '4px', border: '1px solid rgba(56, 139, 253, 0.2)'
                  }}>
                    Verify <ArrowRight size={14} />
                  </Link>
                </td>
              </tr>
            ))}
            {proofs.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <Search size={24} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                  <div>No signed decisions found in the ledger.</div>
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
