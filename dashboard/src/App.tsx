import { useCallback, useEffect, useState } from 'react';
import { ApiClient, formatBps, formatMoney } from './api';
import { CorridorChart } from './components/CorridorChart';
import { ConnectorSplit } from './components/ConnectorSplit';
import { StatCard } from './components/StatCard';
import { TransactionsTable } from './components/TransactionsTable';
import type { AdminMerchant, FeeRule, Summary } from './types';

const DEFAULT_API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.DEV ? '/api' : 'http://localhost:8080');
const DEFAULT_API_KEY =
  (import.meta.env.VITE_API_KEY as string | undefined) ?? 'sk_live_demo_merchant';

export default function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = new ApiClient(apiUrl, apiKey);
      const data = await client.summary();
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, apiKey]);

  // ---- Admin console ----
  const [adminToken, setAdminToken] = useState(
    () => localStorage.getItem('shophippy_admin_token') ?? '',
  );
  const [adminEmail, setAdminEmail] = useState(
    () => localStorage.getItem('shophippy_admin_email') ?? '',
  );
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [feeRules, setFeeRules] = useState<FeeRule[] | null>(null);
  const [merchants, setMerchants] = useState<AdminMerchant[] | null>(null);

  const loadAdminData = useCallback(
    async (token: string) => {
      try {
        const client = new ApiClient(apiUrl, apiKey);
        const [rules, ms] = await Promise.all([
          client.feeRules(token),
          client.merchants(token).catch(() => null),
        ]);
        setFeeRules(rules);
        setMerchants(ms);
        setAdminError(null);
      } catch (e) {
        setAdminError(
          e instanceof Error && /invalid api key|unauthorized/i.test(e.message)
            ? 'Session expired — sign in again.'
            : e instanceof Error
              ? e.message
              : String(e),
        );
      }
    },
    [apiUrl, apiKey],
  );

  useEffect(() => {
    if (adminToken) void loadAdminData(adminToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminBusy(true);
    setAdminError(null);
    try {
      const client = new ApiClient(apiUrl, apiKey);
      const session = await client.adminLogin(loginEmail.trim(), loginPassword);
      localStorage.setItem('shophippy_admin_token', session.session_token);
      localStorage.setItem('shophippy_admin_email', session.email);
      setAdminToken(session.session_token);
      setAdminEmail(session.email);
      setLoginPassword('');
      await loadAdminData(session.session_token);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdminBusy(false);
    }
  };

  const handleAdminLogout = () => {
    localStorage.removeItem('shophippy_admin_token');
    localStorage.removeItem('shophippy_admin_email');
    setAdminToken('');
    setAdminEmail('');
    setFeeRules(null);
    setMerchants(null);
    setAdminError(null);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateTestPayment = async () => {
    try {
      const client = new ApiClient(apiUrl, apiKey);
      await client.request('/v1/payments', {
        method: 'POST',
        body: JSON.stringify({
          amount_minor: 1000 + Math.floor(Math.random() * 900),
          currency: 'USD',
          corridor: 'EU-US',
          destination_country: 'US',
          description: 'Dashboard test charge',
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo">🛍</span>
          <h1>Shophippy</h1>
          <span className="sub">international payment gateway</span>
        </div>
        <form
          className="conn-form"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <input
            aria-label="API URL"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            spellCheck={false}
          />
          <input
            aria-label="API key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            spellCheck={false}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Loading…' : 'Connect'}
          </button>
        </form>
      </header>

      {error && (
        <div className="error-banner">
          {error} — start the API with <code>docker compose up</code> or point the URL at your{' '}
          deployed instance.
        </div>
      )}

      {summary && (
        <main>
          <section className="stats">
            <StatCard
              label="Processed volume"
              value={formatMoney(summary.volume_minor)}
              footer={`${summary.succeeded_count} succeeded · ${summary.failed_count} failed`}
            />
            <StatCard
              label="Gateway fees"
              value={formatMoney(summary.gateway_fee_minor)}
              footer={`${formatMoney(summary.connector_fee_minor)} connector fees`}
            />
            <StatCard
              label="Net volume"
              value={formatMoney(summary.net_volume_minor)}
              footer={`${summary.refund_count} refunds · ${formatMoney(summary.refunded_minor)} refunded`}
            />
            <StatCard
              label="Connectors"
              value={String(summary.by_connector.length)}
              footer={summary.by_connector.map((c) => c.connector).join(', ') || '—'}
            />
          </section>

          <section className="panels">
            <div className="panel">
              <div className="panel-head">
                <h2>Volume by corridor</h2>
                <button onClick={handleCreateTestPayment}>+ Test charge</button>
              </div>
              <CorridorChart data={summary.by_corridor} volumeMinor={summary.volume_minor} />
            </div>
            <div className="panel">
              <h2>Connector split</h2>
              <ConnectorSplit data={summary.by_connector} />
            </div>
          </section>

          <section className="panel">
            <h2>Transactions</h2>
            {summary.recent.length > 0 && (
              <p className="hint">
                Recent payments — fee source shown per row (tier / corridor / merchant rule).
              </p>
            )}
            <TransactionsTable payments={summary.recent} />
          </section>

          <section className="panel">
            <h2>Admin console</h2>
            {adminError && <p className="auth-error">{adminError}</p>}
            {!adminToken ? (
              <form className="auth-form" onSubmit={handleAdminLogin}>
                <input
                  aria-label="Admin email"
                  type="email"
                  placeholder="admin email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  autoComplete="username"
                  required
                />
                <input
                  aria-label="Admin password"
                  type="password"
                  placeholder="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button type="submit" disabled={adminBusy || !loginEmail || !loginPassword}>
                  {adminBusy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            ) : (
              <>
                <div className="auth-row">
                  <p className="hint">
                    Signed in as <strong>{adminEmail}</strong>
                  </p>
                  <button onClick={handleAdminLogout}>Log out</button>
                </div>

                {merchants && merchants.length > 0 && (
                  <div className="table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Merchant</th>
                          <th>Country</th>
                          <th>Tier</th>
                          <th>Onboarded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {merchants.map((m) => (
                          <tr key={m.id}>
                            <td>{m.name}</td>
                            <td>{m.country}</td>
                            <td>{m.tier}</td>
                            <td>{new Date(m.created_at).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {feeRules && feeRules.length > 0 && (
                  <>
                    <h3 className="sub-head">Fee rules</h3>
                    <div className="table-scroll">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Scope</th>
                            <th>Corridor</th>
                            <th>Fee</th>
                            <th>Min amount</th>
                            <th>Priority</th>
                            <th>Active</th>
                          </tr>
                        </thead>
                        <tbody>
                          {feeRules.map((r) => (
                            <tr key={r.id}>
                              <td>{r.scope}</td>
                              <td>{r.corridor ?? '—'}</td>
                              <td>{formatBps(r.bps)}</td>
                              <td>{formatMoney(r.min_amount_minor)}</td>
                              <td>{r.priority}</td>
                              <td>{r.active ? '✓' : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </section>

          <footer className="footer">
            <span>Self-hosted core is free · Managed cloud earns {(0.5).toFixed(1)}%–{(1.5).toFixed(1)}% on volume</span>
            {summary.recent[0] && (
              <span>
                Latest fee rate: {formatBps(summary.recent[0].gateway_fee_bps)} ({summary.recent[0].fee_source})
              </span>
            )}
          </footer>
        </main>
      )}
    </div>
  );
}
