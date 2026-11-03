# Deploying Shophippy

Everything below assumes the repo is cloned and you are authenticated on your
machine. All deployment targets are provisioned in one command per service —
no manual console work is required.

## 1. GitHub

```bash
gh auth login
gh repo create shophippy --public --source=. --remote=origin --push
```

CI (`.github/workflows/ci.yml`) then builds the API (unit tests) and the
dashboard on every push.

## 2. Fly.io (API)

```bash
# one-time
fly auth signup        # or fly auth login

# Postgres + Redis as managed Fly addons (or plug in Upstash/Neon URLs)
fly pg create --name shophippy-db
fly redis create --name shophippy-redis

# wire secrets (use the DB/Redis URLs just printed)
cd api
fly launch --no-deploy --copy-config        # creates the app from api/fly.toml
fly secrets set SHOPHIPPY_DATABASE_URL="postgres://..."
fly secrets set SHOPHIPPY_REDIS_URL="redis://..."
fly secrets set SHOPHIPPY_ADMIN_TOKEN="$(openssl rand -hex 24)"
fly secrets set STRIPE_API_KEY="sk_live_..."        # optional — omit for sandbox mode
fly secrets set PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=...

fly deploy
```

Windows/Hyper-V quirk: if `fly deploy` is blocked by the Docker daemon being
missing locally, deploy with the remote builder: add `remote-only = true`
under `[build]` — Fly builds the Dockerfile on their side.

## 3. Vercel (Dashboard)

```bash
npm i -g vercel
cd dashboard
vercel link
vercel env add VITE_API_URL production     # e.g. https://shophippy-api.fly.dev
vercel env add VITE_API_KEY production     # merchant key served to the dashboard
vercel --prod
```

## 4. Self-hosted (free core, zero gateway fee)

```bash
git clone https://github.com/shophippy/shophippy && cd shophippy
cp api/.env.example api/.env
docker compose up --build
```

Set `SHOPHIPPY_MANAGED_CLOUD=false` (already the default in the compose file)
so the fee engine charges 0 bps.
