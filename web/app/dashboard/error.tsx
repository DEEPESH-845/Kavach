'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Dashboard Error:', error);
  }, [error]);

  return (
    <div style={{
      padding: '40px',
      margin: '20px',
      backgroundColor: 'var(--bg-card)',
      border: '1px solid var(--border-danger, #ff4444)',
      borderRadius: '8px',
      color: 'var(--text-primary)'
    }}>
      <h2 style={{ color: 'var(--status-deny, #ff4444)' }}>Failed to load dashboard data</h2>
      <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>
        Unable to connect to the Kavach backend API. Please make sure the Python server is running on port 8001.
      </p>
      <div style={{ marginTop: '24px', padding: '16px', backgroundColor: 'var(--bg-body)', borderRadius: '4px', fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-tertiary)' }}>
        {error.message}
      </div>
      <button
        onClick={() => reset()}
        style={{
          marginTop: '24px',
          padding: '8px 16px',
          backgroundColor: 'var(--accent-blue)',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
      >
        Try again
      </button>
    </div>
  );
}
