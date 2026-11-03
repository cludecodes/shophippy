import { formatBps, formatMoney } from '../api';
import type { Payment } from '../types';

export function TransactionsTable({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) {
    return (
      <p className="empty">
        No transactions yet. Use <code>curl</code> against <code>/v1/payments</code> or the{' '}
        <strong>Test charge</strong> button above.
      </p>
    );
  }

  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Created</th>
            <th>Status</th>
            <th>Connector</th>
            <th>Amount</th>
            <th>Presentment</th>
            <th>Corridor</th>
            <th>Gateway fee</th>
            <th>Refunded</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className={`row-${p.status}`}>
              <td title={p.id}>{new Date(p.created_at).toLocaleString()}</td>
              <td>
                <span className={`badge badge-${p.status}`}>{p.status}</span>
              </td>
              <td>{p.connector}</td>
              <td>{formatMoney(p.amount_minor, p.currency)}</td>
              <td>{p.presentment_currency ?? '—'}</td>
              <td>{p.corridor ?? 'domestic'}</td>
              <td title={`source: ${p.fee_source}`}>
                {formatMoney(p.gateway_fee_minor, p.currency)}{' '}
                <span className="bps">{formatBps(p.gateway_fee_bps)}</span>
              </td>
              <td>{p.refunded_minor > 0 ? formatMoney(p.refunded_minor, p.currency) : '—'}</td>
              <td className="desc">{p.description ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
