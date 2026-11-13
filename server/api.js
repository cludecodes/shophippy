import dotenv from 'dotenv'
import express from 'express'
import pg from 'pg'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkflow } from './workflow.js'
import { generatePack } from './packEngine.js'
import { createAdminRouter } from './admin.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(root, '.env.local') })
dotenv.config({ path: path.join(root, '.env') })

const databaseUrl = process.env.DATABASE_URL
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, max: 5 }) : null
const rateLimits = new Map()
const rateLimitWindowMs = 15 * 60 * 1000
const maxQuotesPerWindow = 5
const workflow = createWorkflow({ pool, generatePack })

if (pool) {
  pool.on('error', (error) => {
    console.error('Unexpected Neon database pool error:', error.message)
  })
}

export function createApiRouter() {
  const router = express.Router()
  router.use(express.json({ limit: '16kb' }))
  router.use('/admin', createAdminRouter({ pool, workflow }))
  router.get('/health', async (_request, response) => {
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

  router.post('/quotes', async (request, response) => {
    if (!pool) {
      response.status(503).json({ error: 'Database is not configured. Set DATABASE_URL.' })
      return
    }

    const forwardedFor = request.get('x-forwarded-for')?.split(',')[0].trim()
    const ip = forwardedFor || request.socket.remoteAddress || 'unknown'
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
          (project_type, full_name, email, phone, country, company, currency, budget_range, details, contact_consent, form_data, public_reference, raw_submission)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb)
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
          null,
          // Immutable snapshot of the validated original submission.
          JSON.stringify(quote),
        ],
      )
      const requestId = result.rows[0].id
      // Human-readable, non-sensitive reference: SH-XXXXXXXX from the UUID.
      const reference = `SH-${requestId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
      await pool.query(
        'UPDATE public.quote_requests SET public_reference = $2 WHERE id = $1',
        [requestId, reference],
      )

      // Quote-to-pack workflow runs server-side before responding (it is
      // fast and must not depend on the client keeping the connection).
      let workflowStatus = 'new'
      const workflowResult = await workflow.processNewQuote(requestId)
      if (workflowResult?.ok && workflowResult.status) workflowStatus = workflowResult.status

      response.status(201).json({ id: requestId, reference, status: workflowStatus })
    } catch (error) {
      console.error('Saving quote request to Neon failed:', error.message)
      response.status(500).json({ error: 'We could not save your quote request. Please try again.' })
    }
  })

  router.use((_request, response) => {
    response.status(404).json({ error: 'API route not found.' })
  })

  router.use((error, _request, response, _next) => {
    if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
      response.status(400).json({ error: 'The request body is invalid.' })
      return
    }
    console.error('Unexpected API error:', error?.message || error)
    response.status(500).json({ error: 'Unexpected server error. Please try again.' })
  })

  return router
}

export async function closeApiPool() {
  if (pool) await pool.end()
}
