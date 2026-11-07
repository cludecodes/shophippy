-- Admin console authentication (email + password login, DB-backed sessions)

CREATE TABLE admin_users (
    id            UUID PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    -- argon2id PHC string, never reversible
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
    token_hash  TEXT PRIMARY KEY,          -- sha256 of the opaque bearer token
    admin_id    UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_sessions_admin ON admin_sessions (admin_id);
CREATE INDEX idx_admin_sessions_expiry ON admin_sessions (expires_at);
