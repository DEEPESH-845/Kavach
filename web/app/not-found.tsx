import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: '#08090a',
      color: '#f0f2f5',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    }}>
      <h1 style={{ fontSize: '48px', fontWeight: 500, margin: '0 0 16px 0', letterSpacing: '-0.02em' }}>404</h1>
      <p style={{ fontSize: '18px', color: '#9ba1a6', margin: '0 0 32px 0' }}>The page you’re looking for doesn’t exist.</p>
      <div style={{ display: 'flex', gap: '16px' }}>
        <Link href="/dashboard" style={{
          padding: '10px 20px',
          backgroundColor: 'rgba(0, 102, 255, 0.1)',
          color: '#0066ff',
          textDecoration: 'none',
          borderRadius: '6px',
          fontWeight: 500,
          border: '1px solid rgba(0, 102, 255, 0.2)'
        }}>Back to Dashboard</Link>
        <Link href="/" style={{
          padding: '10px 20px',
          backgroundColor: '#14171c',
          color: '#f0f2f5',
          textDecoration: 'none',
          borderRadius: '6px',
          fontWeight: 500,
          border: '1px solid #1f232b'
        }}>Go Home</Link>
      </div>
    </div>
  );
}
