interface StatCardProps {
  label: string;
  value: string;
  footer: string;
}

export function StatCard({ label, value, footer }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-footer">{footer}</div>
    </div>
  );
}
