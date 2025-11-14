import React from 'react';
import { useSearchParams } from 'react-router-dom';

function ErrorPage() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error') || 'unknown_error';
  const errorDescription = searchParams.get('error_description') || 'An unknown error occurred';
  const redirectUri = searchParams.get('redirect_uri');
  const state = searchParams.get('state');

  const handleReturn = () => {
    if (redirectUri) {
      const url = new URL(redirectUri);
      url.searchParams.set('error', error);
      url.searchParams.set('error_description', errorDescription);
      if (state) url.searchParams.set('state', state);
      window.location.href = url.toString();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.errorIcon}>⚠️</div>
        <h1 style={styles.title}>Authorization Error</h1>
        <div style={styles.errorDetails}>
          <p style={styles.errorCode}>Error: {error}</p>
          <p style={styles.errorDescription}>{errorDescription}</p>
        </div>
        {redirectUri ? (
          <button style={styles.button} onClick={handleReturn}>
            Return to Application
          </button>
        ) : (
          <p style={styles.noRedirect}>
            No return URL provided. Please close this window and try again.
          </p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  card: {
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    padding: '40px',
    maxWidth: '500px',
    width: '100%',
    textAlign: 'center',
  },
  errorIcon: {
    fontSize: '64px',
    marginBottom: '20px',
  },
  title: {
    fontSize: '28px',
    fontWeight: '600',
    color: '#1a202c',
    marginBottom: '20px',
  },
  errorDetails: {
    background: '#fff5f5',
    border: '1px solid #feb2b2',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '30px',
    textAlign: 'left',
  },
  errorCode: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#c53030',
    marginBottom: '8px',
    fontFamily: 'monospace',
  },
  errorDescription: {
    fontSize: '14px',
    color: '#742a2a',
    lineHeight: 1.5,
  },
  button: {
    padding: '14px 32px',
    background: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  noRedirect: {
    fontSize: '14px',
    color: '#718096',
  },
};

export default ErrorPage;
