import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';

function AuthorizePage() {
  const [searchParams] = useSearchParams();
  const { ready, authenticated, user, login, getAccessToken } = usePrivy();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract OAuth parameters from URL
  const clientId = searchParams.get('client_id');
  const redirectUri = searchParams.get('redirect_uri');
  const scope = searchParams.get('scope') || 'read';
  const state = searchParams.get('state');
  const codeChallenge = searchParams.get('code_challenge');
  const codeChallengeMethod = searchParams.get('code_challenge_method');

  // Handle automatic authorization once authenticated
  useEffect(() => {
    // Validate required OAuth parameters
    if (!clientId || !redirectUri || !codeChallenge || !codeChallengeMethod) {
      setError('Invalid authorization request: missing required parameters');
      return;
    }

    if (codeChallengeMethod !== 'S256') {
      setError('Invalid code_challenge_method: only S256 is supported');
      return;
    }

    // If user is authenticated and not already processing, automatically grant authorization
    if (ready && authenticated && user && !processing && !error) {
      handleAutomaticAuthorization();
    }
  }, [ready, authenticated, user, clientId, redirectUri, codeChallenge, codeChallengeMethod]);

  const handleAutomaticAuthorization = async () => {
    try {
      setProcessing(true);

      // Get Privy access token
      const privyToken = await getAccessToken();
      if (!privyToken) {
        throw new Error('Failed to get Privy access token');
      }

      // Send authorization to backend
      const response = await fetch('/authorize/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          privy_user_id: user?.id,
          privy_token: privyToken,  // Include the Privy token for later exchange
          user_consent: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error_description || 'Failed to grant authorization');
      }

      const data = await response.json();

      // Redirect back to ChatGPT with authorization code
      window.location.href = data.redirect_uri;
    } catch (err) {
      console.error('Authorization error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process authorization');
      setProcessing(false);
    }
  };

  const handleLogin = async () => {
    try {
      setError(null);
      await login();
      // After successful login, useEffect will automatically handle authorization
    } catch (err) {
      console.error('Login error:', err);
      setError('Failed to authenticate. Please try again.');
    }
  };

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.errorIcon}>⚠️</div>
          <h1 style={styles.title}>Authorization Error</h1>
          <p style={styles.errorText}>{error}</p>
          {redirectUri && (
            <button
              style={styles.button}
              onClick={() => {
                const url = new URL(redirectUri);
                url.searchParams.set('error', 'invalid_request');
                url.searchParams.set('error_description', error);
                if (state) url.searchParams.set('state', state);
                window.location.href = url.toString();
              }}
            >
              Return to Application
            </button>
          )}
        </div>
      </div>
    );
  }

  // If processing or authenticated, show loading state
  if (processing || (ready && authenticated && user)) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>Authorizing...</p>
        </div>
      </div>
    );
  }

  // If not ready, show initializing
  if (!ready) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>Initializing...</p>
        </div>
      </div>
    );
  }

  // Show login button for unauthenticated users
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>Sign In Required</h1>
          <p style={styles.subtitle}>
            ChatGPT needs you to authenticate to continue
          </p>
        </div>

        <div style={styles.appInfo}>
          <div style={styles.appIcon}>🤖</div>
          <h2 style={styles.appName}>ChatGPT</h2>
        </div>

        <button
          style={styles.button}
          onClick={handleLogin}
        >
          Sign in with Privy
        </button>

        <p style={styles.footer}>
          You'll be redirected back to ChatGPT after signing in
        </p>
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
  },
  header: {
    textAlign: 'center',
    marginBottom: '30px',
  },
  title: {
    fontSize: '28px',
    fontWeight: '600',
    color: '#1a202c',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#718096',
  },
  appInfo: {
    textAlign: 'center',
    padding: '20px',
    background: '#f7fafc',
    borderRadius: '8px',
    marginBottom: '30px',
  },
  appIcon: {
    fontSize: '48px',
    marginBottom: '12px',
  },
  appName: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#2d3748',
    marginBottom: '8px',
  },
  button: {
    width: '100%',
    padding: '14px',
    background: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  footer: {
    textAlign: 'center',
    fontSize: '13px',
    color: '#a0aec0',
    marginTop: '20px',
  },
  spinner: {
    border: '3px solid #f3f4f6',
    borderTop: '3px solid #667eea',
    borderRadius: '50%',
    width: '40px',
    height: '40px',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 16px',
  },
  loadingText: {
    textAlign: 'center',
    color: '#718096',
  },
  errorIcon: {
    fontSize: '48px',
    textAlign: 'center',
    marginBottom: '16px',
  },
  errorText: {
    color: '#e53e3e',
    textAlign: 'center',
    marginBottom: '20px',
  },
};

export default AuthorizePage;
