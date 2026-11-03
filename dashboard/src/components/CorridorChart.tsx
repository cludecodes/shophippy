import { formatMoney } from '../api';
import type { CorridorSlice } from '../types';

interface Props {
  data: CorridorSlice[];
  volumeMinor: number;
}

/** Dependency-free SVG bar chart — keeps the dashboard bundle small. */
export function CorridorChart({ data, volumeMinor }: Props) {
  if (data.length === 0) {
    return <p className="empty">No corridor volume yet — send a payment with a corridor (e.g. "EU-US").</p>;
  }

  const max = Math.max(...data.map((d) => d.volume_minor), 1);
  return (
    <div className="corridor-chart">
      {data.map((d) => (
        <div key={d.corridor} className="corridor-row" title={formatMoney(d.volume_minor)}>
          <span className="corridor-name">{d.corridor}</span>
          <div className="bar-track">
            <div
              className="bar"
              style={{ width: `${Math.round((d.volume_minor / max) * 100)}%` }}
            >
              <span className="share"> {Math.round((d.volume_minor / Math.max(volumeMinor, 1)) * 100)}%</span>
            </div>
          </div>
          <span className="corridor-amount">{formatMoney(d.volume_minor)}</span>
        </div>
      ))}
    </div>
  );
}
