import type { FeeRule, Summary } from './types';

export class ApiClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 401) throw new Error('Invalid API key');
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
    }
    return (await res.json()) as T;
  }

  summary(): Promise<Summary> {
    return this.request<Summary>('/v1/dashboard/summary');
  }

  feeRules(adminToken: string): Promise<FeeRule[]> {
    return this.request<FeeRule[]>('/admin/fee-rules', {
      headers: { 'X-Admin-Token': adminToken },
    });
  }
}

export function formatMoney(minor: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}
