# Shophippy

**Shophippy** is an open-source international payment gateway. The self-hosted
core is free (Apache 2.0); the managed cloud earns a transparent percentage fee
(0.5 %–1.5 %) on transaction volume.

## Architecture

```
                  ┌──────────────────────────────┐
   Merchant API ──▶  Rust API (axum)              │──▶ Stripe connector
                  │  - payments / refunds        │──▶ PayPal connector
                  │  - fee engine                │
                  │  - ledger (PostgreSQL)       │
                  │  - idempotency (Redis)       │
                  └──────────────────────────────┘
                              ▲
                  ┌───────────┴────────────┐
                  │  React + TS dashboard  │
                  │  volume / fees / txns  │
                  └────────────────────────┘
```

| Component     | Tech                                      |
|---------------|-------------------------------------------|
| API           | Rust, axum, sqlx, reqwest                 |
| Ledger        | PostgreSQL (double-entry style `entries`) |
| Idempotency   | Redis                                     |
| Connectors    | Pluggable trait (`connectors::Connector`) — Stripe + PayPal MVP |
| Fees          | Percentage fee engine, per-merchant + per-corridor rules |
| Dashboard     | React 18 + TypeScript + Vite              |
| Local dev     | Docker Compose                            |

## Quick start (local development)

```bash
cp api/.env.example api/.env      # fill in connector keys or leave as sandbox
docker compose up --build
```

- API:        http://localhost:8080
- Dashboard:  http://localhost:5173
- Postgres:   localhost:5432 (`shophippy` / `shophippy`)
- Redis:      localhost:6379

Migrations are applied automatically on API startup (`sqlx::migrate!`).

## Live demonstration deployment

| Component | URL | Notes |
|-----------|-----|-------|
| API       | https://spg-ojawew.fly.dev | Fly.io, AMS region, managed-cloud fee mode (150 bps demo rules) |
| Demo key  | `sk_live_demo_merchant` | Demo merchant seeded automatically |
| Admin     | `X-Admin-Token` | see `SHOPHIPPY_ADMIN_TOKEN` secret |

```bash
curl -X POST https://spg-ojawew.fly.dev/v1/payments \
  -H "X-Api-Key: sk_live_demo_merchant" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"amount_minor": 10500, "currency": "USD", "corridor": "EU-US", "destination_country": "US"}'
```

Connectors run in **sandbox mode** on the demo deployment (deterministic
simulated results, no real money moves). Postgres and Redis run as dedicated
machines on the same Fly private network.

## Create a payment

```bash
curl -X POST http://localhost:8080/v1/payments \
  -H "X-Api-Key: sk_live_demo_merchant" \
  -H "Idempotency-Key: 11111111-2222-3333-4444-555555555555" \
  -H "Content-Type: application/json" \
  -d '{
    "amount_minor": 10500,
    "currency": "USD",
    "presentment_currency": "EUR",
    "connector": "stripe",
    "corridor": "EU-US",
    "destination_country": "US",
    "description": "Order 42"
  }'
```

The API responds with the connector result **plus a fee breakdown**:

```json
{
  "id": "pay_...",
  "status": "succeeded",
  "amount_minor": 10500,
  "currency": "USD",
  "fee_major": { "gateway_fee_minor": 105, "connector_fee_minor": 315, "total_minor": 420 },
  "connector_ref": "pi_..."
}
```

## Fee model

The gateway earns a **percentage fee on managed-cloud volume**:

- Base fee: **1.5%** (managed cloud default)
- Volume tiers bring it down to as low as **0.5%**
- Per-merchant overrides (`fee_rules` scope = `merchant`)
- Per-corridor rules (`fee_rules` scope = `corridor`, e.g. `EU-US`)
- Self-hosted instances run with fee = 0 (free core)

Fee rules are stored in PostgreSQL and evaluated in order:
`merchant override > corridor rule > tier schedule`.

## Self-hosting

Self-hosted deployments are free and run at zero gateway fee. Point the API at
your own Postgres/Redis and connector keys — see `docker-compose.yml` and
`api/.env.example`.

## Deployment

- **API → Fly.io**: app `spg-ojawew` (live at https://spg-ojawew.fly.dev); see `api/fly.toml` and `DEPLOY.md`
- **Dashboard → Vercel**: `vercel --prod` from `dashboard/`
- **GitHub**: https://github.com/cludecodes/shophippy

## License

Apache 2.0 — see [LICENSE](LICENSE).
