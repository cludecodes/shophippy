-- Shophippy ledger schema (PostgreSQL)
-- Migrations are applied automatically on API startup via sqlx::migrate!

CREATE TABLE merchants (
    id              UUID PRIMARY KEY,
    name            TEXT NOT NULL,
    api_key_hash    TEXT NOT NULL UNIQUE,
    country         TEXT NOT NULL,
    tier            INT  NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Percentage fee rules. Evaluation order (highest priority wins):
--   1. merchant scope overrides (tie-broken by priority DESC)
--   2. corridor rules (e.g. 'EU-US')
--   3. volume-tier schedule (tier 0 => 150 bps ... tier 3 => 50 bps)
-- bps: basis points of the transaction amount, 50 = 0.5%, 150 = 1.5%.
CREATE TABLE fee_rules (
    id               UUID PRIMARY KEY,
    scope            TEXT NOT NULL CHECK (scope IN ('global', 'merchant', 'corridor')),
    merchant_id      UUID REFERENCES merchants(id) ON DELETE CASCADE,
    corridor         TEXT,
    bps              BIGINT NOT NULL CHECK (bps >= 0 AND bps <= 155),
    min_amount_minor BIGINT NOT NULL DEFAULT 0,
    priority         INT NOT NULL DEFAULT 0,
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
    id                   UUID PRIMARY KEY,
    merchant_id          UUID NOT NULL REFERENCES merchants(id),
    status               TEXT NOT NULL,
    connector            TEXT NOT NULL,
    connector_ref        TEXT,
    connector_fee_minor  BIGINT NOT NULL DEFAULT 0,
    amount_minor         BIGINT NOT NULL CHECK (amount_minor > 0),
    currency             TEXT NOT NULL,
    presentment_currency TEXT,
    fx_rate              NUMERIC(18, 8),
    corridor             TEXT,
    destination_country  TEXT,
    gateway_fee_bps      BIGINT NOT NULL DEFAULT 0,
    gateway_fee_minor    BIGINT NOT NULL DEFAULT 0,
    fee_source           TEXT NOT NULL DEFAULT 'tier',
    refunded_minor       BIGINT NOT NULL DEFAULT 0,
    idempotency_key      UUID NOT NULL,
    description          TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (merchant_id, idempotency_key)
);

CREATE INDEX idx_payments_merchant_created ON payments (merchant_id, created_at DESC);
CREATE INDEX idx_payments_status ON payments (status);

CREATE TABLE refunds (
    id            UUID PRIMARY KEY,
    payment_id    UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    merchant_id   UUID NOT NULL REFERENCES merchants(id),
    amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
    status        TEXT NOT NULL,
    connector_ref TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
    id           UUID PRIMARY KEY,
    merchant_id  UUID NOT NULL REFERENCES merchants(id),
    currency     TEXT NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    status       TEXT NOT NULL DEFAULT 'pending',
    arrival_date TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
    id           BIGSERIAL PRIMARY KEY,
    payment_id   UUID REFERENCES payments(id) ON DELETE SET NULL,
    merchant_id  UUID NOT NULL REFERENCES merchants(id),
    account      TEXT NOT NULL,
    entry_type   TEXT NOT NULL,
    direction    TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
    currency     TEXT NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_payment ON ledger_entries (payment_id);
CREATE INDEX idx_ledger_account ON ledger_entries (account, created_at DESC);
