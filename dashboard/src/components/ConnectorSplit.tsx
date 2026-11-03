import { formatMoney } from '../api';
import type { ConnectorSlice } from '../types';

export function ConnectorSplit({ data }: { data: ConnectorSlice[] }) {
  if (data.length === 0) {
    return <p className="empty">No processed volume yet.</p>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Connector</th>
          <th>Volume</th>
          <th>Gateway fees</th>
          <th>Transactions</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.connector}>
            <td className="connector-name">{row.connector}</td>
            <td>{formatMoney(row.volume_minor)}</td>
            <td>{formatMoney(row.fees_minor)}</td>
            <td>{row.txn_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
