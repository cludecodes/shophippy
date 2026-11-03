export interface Summary {
  volume_minor: number;
  gateway_fee_minor: number;
  connector_fee_minor: number;
  refunded_minor: number;
  net_volume_minor: number;
  succeeded_count: number;
  failed_count: number;
  refund_count: number;
  by_connector: ConnectorSlice[];
  by_corridor: CorridorSlice[];
  recent: Payment[];
}

export interface ConnectorSlice {
  connector: string;
  volume_minor: number;
  fees_minor: number;
  txn_count: number;
}

export interface CorridorSlice {
  corridor: string;
  volume_minor: number;
  fees_minor: number;
}

export interface Payment {
  id: string;
  status: string;
  connector: string;
  amount_minor: number;
  currency: string;
  presentment_currency: string | null;
  corridor: string | null;
  destination_country: string | null;
  gateway_fee_bps: number;
  gateway_fee_minor: number;
  fee_source: string;
  refunded_minor: number;
  description: string | null;
  created_at: string;
}

export interface FeeRule {
  id: string;
  scope: string;
  corridor: string | null;
  bps: number;
  min_amount_minor: number;
  priority: number;
  active: boolean;
}
