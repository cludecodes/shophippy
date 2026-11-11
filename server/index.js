import dotenv from 'dotenv'
import express from 'express'
import pg from 'pg'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(root, '.env.local') })
dotenv.config({ path: path.join(root, '.env') })

const app = express()
const port = Number(process.env.API_PORT || 3001)
const databaseUrl = process.env.DATABASE_URL
const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production')
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, max: 5 }) : null
const rateLimits = new Map()
const rateLimitWindowMs = 15 * 60 * 1000
const maxQuotesPerWindow = 5

if (pool) {
  pool.on('error', (error) => {
    console.error('Unexpected Neon database pool error:', error.message)
  })
}

app.disable('x-powered-by')
app.use(express.json({ limit: '16kb' }))

app.get('/api/health', async (_request, response) => {
  if (!pool) {
    response.status(503).json({ error: 'Database is not configured. Set DATABASE_URL.' })
    return
  }

  try {
    await pool.query('SELECT 1')
    response.json({ status: 'ok', database: 'connected' })
  } catch (error) {
    console.error('Neon health check failed:', error.message)
    response.status(503).json({ error: 'Database connection failed.' })
  }
})

app.post('/api/quotes', async (request, response) => {
  if (!pool) {
    response.status(503).json({ error: 'Database is not configured. Set DATABASE_URL.' })
    return
  }

  const ip = request.socket.remoteAddress || 'unknown'
  const now = Date.now()
  for (const [address, limit] of rateLimits) {
    if (limit.expiresAt <= now) rateLimits.delete(address)
  }
  const limit = rateLimits.get(ip)
  if (limit && limit.expiresAt > now && limit.count >= maxQuotesPerWindow) {
    response.status(429).json({ error: 'Too many quote requests. Please try again later.' })
    return
  }
  if (!limit && rateLimits.size >= 10000) {
    response.status(429).json({ error: 'Quote requests are temporarily busy. Please try again later.' })
    return
  }
  rateLimits.set(ip, {
    count: limit && limit.expiresAt > now ? limit.count + 1 : 1,
    expiresAt: limit && limit.expiresAt > now ? limit.expiresAt : now + rateLimitWindowMs,
  })

  const quote = request.body
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) {
    response.status(400).json({ error: 'A quote request is required.' })
    return
  }

  const requiredText = ['projectType', 'fullName', 'email', 'phone', 'country', 'budgetRange', 'details']
  const invalidRequiredText = requiredText.some((key) =>
    typeof quote[key] !== 'string' || quote[key].trim().length === 0,
  )
  if (invalidRequiredText) {
    response.status(400).json({ error: 'Complete all required quote fields.' })
    return
  }

  const email = quote.email.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 320) {
    response.status(400).json({ error: 'Enter a valid email address.' })
    return
  }
  if (quote.fullName.trim().length > 200
    || quote.phone.trim().length > 50
    || quote.country.trim().length > 100
    || quote.projectType.trim().length > 100
    || quote.budgetRange.trim().length > 100
    || (quote.company != null && (typeof quote.company !== 'string' || quote.company.trim().length > 200))
    || quote.details.trim().length < 15
    || quote.details.trim().length > 5000) {
    response.status(400).json({ error: 'One or more quote fields exceed the allowed length.' })
    return
  }
  if (!['USD', 'PKR'].includes(quote.currency)) {
    response.status(400).json({ error: 'Choose USD or PKR for the quote currency.' })
    return
  }
  if (quote.contactConsent !== true) {
    response.status(400).json({ error: 'Contact consent is required to submit a quote request.' })
    return
  }
  if (!quote.formData || typeof quote.formData !== 'object' || Array.isArray(quote.formData)) {
    response.status(400).json({ error: 'Quote form details are invalid.' })
    return
  }

  try {
    const result = await pool.query(
      `INSERT INTO public.quote_requests
        (project_type, full_name, email, phone, country, company, currency, budget_range, details, contact_consent, form_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING id`,
      [
        quote.projectType.trim(),
        quote.fullName.trim(),
        email,
        quote.phone.trim(),
        quote.country.trim(),
        typeof quote.company === 'string' && quote.company.trim() ? quote.company.trim() : null,
        quote.currency,
        quote.budgetRange.trim(),
        quote.details.trim(),
        quote.contactConsent,
        JSON.stringify(quote.formData),
      ],
    )
    response.status(201).json({ id: result.rows[0].id })
  } catch (error) {
    console.error('Saving quote request to Neon failed:', error.message)
    response.status(500).json({ error: 'We could not save your quote request. Please try again.' })
  }
})

if (isProduction) {
  const dist = path.resolve(root, 'shophippy-studio', 'dist')
  app.use(express.static(dist))
  app.get('*', (_request, response, next) => {
    response.sendFile(path.join(dist, 'index.html'), (error) => {
      if (error) next(error)
    })
  })
}

const server = app.listen(port, () => {
  console.log(`Quote API listening on http://localhost:${port}`)
})

const shutdown = async () => {
  server.close()
  if (pool) await pool.end()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
