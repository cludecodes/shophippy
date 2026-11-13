// Authenticated admin API (skills.md Skill 12 + section 7/8/9).
// Security model for this slice: single 'owner' role unlocked by the
// ADMIN_PASSWORD environment variable, HMAC-signed HttpOnly session cookie.
// The users/roles schema can be layered on later without changing routes.

import crypto from 'node:crypto'
import express from 'express'

const SESSION_COOKIE = 'shophippy_admin_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const ARTIFACT_FOLDERS = {
  'original-submission': '00-source',
  'executive-summary': '01-analysis',
  'requirements-brief': '01-analysis',
  requirements: '01-analysis',
  'client-questions': '01-analysis',
  'solution-architecture': '02-solution',
  'ux-plan': '02-solution',
  'scope-of-work': '02-solution',
  deliverables: '02-solution',
  'estimate-internal': '03-estimation',
  'assumptions-and-exclusions': '03-estimation',
  'production-plan': '04-production',
  'task-backlog': '04-production',
  'master-build-prompt': '05-prompts',
  'frontend-agent-prompt': '05-prompts',
  'backend-agent-prompt': '05-prompts',
  'database-agent-prompt': '05-prompts',
  'integration-agent-prompt': '05-prompts',
  'qa-agent-prompt': '05-prompts',
  'devops-agent-prompt': '05-prompts',
  'documentation-agent-prompt': '05-prompts',
  'qa-test-plan': '06-quality-and-risk',
  'risk-review': '06-quality-and-risk',
  'release-checklist': '06-quality-and-risk',
}

// Required artifact types before a pack can be approved.
const REQUIRED_ARTIFACTS = [
  'original-submission',
  'executive-summary',
  'requirements-brief',
  'requirements',
  'scope-of-work',
  'estimate-internal',
  'production-plan',
  'master-build-prompt',
  'qa-test-plan',
  'risk-review',
]

function sessionSecret() {
  const configured = process.env.ADMIN_SESSION_SECRET
  if (configured && configured.length >= 32) return configured
  const password = process.env.ADMIN_PASSWORD
  if (!password) return null
  return crypto.createHash('sha256').update(`shophippy-admin:${password}`).digest()
}

function signSession(expiresAtMs, secret) {
  return crypto.createHmac('sha256', secret).update(String(expiresAtMs)).digest('hex')
}

function createSessionToken(secret) {
  const expiresAt = Date.now() + SESSION_TTL_MS
  return { token: `${expiresAt}.${signSession(expiresAt, secret)}`, expiresAt }
}

function verifySessionToken(token, secret) {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot < 1) return false
  const expiresAt = Number(token.slice(0, dot))
  const signature = token.slice(dot + 1)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false
  const expected = signSession(expiresAt, secret)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function readCookie(request, name) {
  const header = request.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

function timingSafePasswordCompare(candidate, expected) {
  const a = crypto.createHash('sha256').update(String(candidate)).digest()
  const b = crypto.createHash('sha256').update(String(expected)).digest()
  return crypto.timingSafeEqual(a, b)
}

function artifactFileName(artifact) {
  const extension = artifact.format === 'json' ? 'json' : artifact.format === 'mermaid' ? 'mmd' : 'md'
  return `${artifact.artifact_type}.${extension}`
}

export function createAdminRouter({ pool, workflow }) {
  const router = express.Router()
  router.use(express.json({ limit: '256kb' }))
  router.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    next()
  })

  const secret = sessionSecret()
  const loginAttempts = new Map()
  const loginWindowMs = 15 * 60 * 1000
  const maxLoginAttempts = 8

  function fail(response, status, error) {
    response.status(status).json({ error })
  }

  function requireAuth(request, response, next) {
    if (!secret) {
      fail(response, 503, 'Admin access is not configured. Set ADMIN_PASSWORD.')
      return
    }
    const token = readCookie(request, SESSION_COOKIE)
    if (!verifySessionToken(token, secret)) {
      fail(response, 401, 'Not authenticated.')
      return
    }
    request.adminActor = 'owner'
    next()
  }

  function requirePool(request, response, next) {
    if (!pool) {
      fail(response, 503, 'Database is not configured. Set DATABASE_URL.')
      return
    }
    next()
  }

  function recordAudit(client, requestId, actor, action, entity, detail) {
    return client.query(
      `INSERT INTO public.quote_audit_events (quote_request_id, actor, action, entity, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [requestId, actor, action, entity, JSON.stringify(detail || {})],
    )
  }

  async function loadLatestArtifactsByType(client, requestId) {
    const result = await client.query(
      `SELECT DISTINCT ON (artifact_type)
         id, artifact_type, title, content, format, version, generated_by,
         created_at, approval_status, approved_by, approved_at
       FROM public.quote_artifacts
       WHERE quote_request_id = $1
       ORDER BY artifact_type, version DESC`,
      [requestId],
    )
    return result.rows
  }

  // ---- auth ----
  router.post('/login', (request, response) => {
    if (!secret) {
      fail(response, 503, 'Admin access is not configured. Set ADMIN_PASSWORD.')
      return
    }
    const expected = process.env.ADMIN_PASSWORD
    if (!expected) {
      fail(response, 503, 'Admin access is not configured. Set ADMIN_PASSWORD.')
      return
    }

    const forwardedFor = request.get('x-forwarded-for')?.split(',')[0].trim()
    const ip = forwardedFor || request.socket.remoteAddress || 'unknown'
    const now = Date.now()
    for (const [address, entry] of loginAttempts) {
      if (entry.expiresAt <= now) loginAttempts.delete(address)
    }
    const attempt = loginAttempts.get(ip)
    if (attempt && attempt.expiresAt > now && attempt.count >= maxLoginAttempts) {
      fail(response, 429, 'Too many login attempts. Try again later.')
      return
    }

    const password = typeof request.body?.password === 'string' ? request.body.password : ''
    if (!password || !timingSafePasswordCompare(password, expected)) {
      loginAttempts.set(ip, {
        count: attempt && attempt.expiresAt > now ? attempt.count + 1 : 1,
        expiresAt: attempt && attempt.expiresAt > now ? attempt.expiresAt : now + loginWindowMs,
      })
      fail(response, 401, 'Invalid password.')
      return
    }
    loginAttempts.delete(ip)

    const { token, expiresAt } = createSessionToken(secret)
    response.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    )
    response.json({ ok: true, role: 'owner' })
  })

  router.post('/logout', (request, response) => {
    response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
    response.json({ ok: true })
  })

  router.get('/session', requireAuth, (_request, response) => {
    response.json({ authenticated: true, role: 'owner' })
  })

  // ---- requests list ----
  router.get('/requests', requireAuth, requirePool, async (request, response, next) => {
    try {
      const page = Math.max(1, Number(request.query.page) || 1)
      const pageSize = 20
      const status = typeof request.query.status === 'string' && request.query.status ? request.query.status : null
      const search = typeof request.query.q === 'string' && request.query.q.trim() ? `%${request.query.q.trim()}%` : null

      const conditions = []
      const values = []
      if (status) {
        values.push(status)
        conditions.push(`status = $${values.length}`)
      }
      if (search) {
        values.push(search)
        conditions.push(`(public_reference ILIKE $${values.length} OR full_name ILIKE $${values.length} OR email ILIKE $${values.length} OR project_type ILIKE $${values.length})`)
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

      const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM public.quote_requests ${where}`, values)
      const listResult = await pool.query(
        `SELECT id, public_reference, full_name, email, project_type, status,
                budget_range, currency, assigned_to, created_at
         FROM public.quote_requests ${where}
         ORDER BY created_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, pageSize, (page - 1) * pageSize],
      )
      response.json({
        requests: listResult.rows,
        total: countResult.rows[0].total,
        page,
        pageSize,
      })
    } catch (error) {
      next(error)
    }
  })

  // ---- request detail ----
  router.get('/requests/:id', requireAuth, requirePool, async (request, response, next) => {
    try {
      const requestResult = await pool.query(
        `SELECT id, public_reference, status, full_name, email, phone, country, company,
                project_type, currency, budget_range, details, contact_consent,
                form_data, raw_submission, assigned_to, created_at, updated_at
         FROM public.quote_requests WHERE id = $1`,
        [request.params.id],
      )
      if (requestResult.rowCount === 0) {
        fail(response, 404, 'Request not found.')
        return
      }

      const [artifacts, runs, audit] = await Promise.all([
        pool.query(
          `SELECT id, artifact_type, title, content, format, version, generated_by,
                  created_at, approval_status, approved_by, approved_at
           FROM public.quote_artifacts
           WHERE quote_request_id = $1
           ORDER BY artifact_type, version DESC`,
          [request.params.id],
        ),
        pool.query(
          `SELECT id, skill_name, status, started_at, completed_at, retry_count, error_summary
           FROM public.quote_agent_runs
           WHERE quote_request_id = $1
           ORDER BY started_at DESC`,
          [request.params.id],
        ),
        pool.query(
          `SELECT id, actor, action, entity, detail, created_at
           FROM public.quote_audit_events
           WHERE quote_request_id = $1
           ORDER BY created_at DESC
           LIMIT 200`,
          [request.params.id],
        ),
      ])

      response.json({
        request: requestResult.rows[0],
        artifacts: artifacts.rows,
        agentRuns: runs.rows,
        auditEvents: audit.rows,
      })
    } catch (error) {
      next(error)
    }
  })

  // ---- artifact edit (creates a NEW version; approved artifacts immutable) ----
  router.put('/requests/:id/artifacts/:artifactId', requireAuth, requirePool, async (request, response, next) => {
    try {
      const content = request.body?.content
      if (typeof content !== 'string' || content.length === 0 || content.length > 200000) {
        fail(response, 400, 'Artifact content must be a non-empty string under 200k characters.')
        return
      }
      const existing = await pool.query(
        `SELECT id, artifact_type, title, format, version, approval_status
         FROM public.quote_artifacts
         WHERE id = $1 AND quote_request_id = $2`,
        [request.params.artifactId, request.params.id],
      )
      if (existing.rowCount === 0) {
        fail(response, 404, 'Artifact not found.')
        return
      }
      if (existing.rows[0].approval_status === 'approved') {
        fail(response, 409, 'Approved artifact versions are immutable. Regenerate or reject the pack first.')
        return
      }

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const versionResult = await client.query(
          `SELECT COALESCE(MAX(version), 0) + 1 AS next
           FROM public.quote_artifacts
           WHERE quote_request_id = $1 AND artifact_type = $2`,
          [request.params.id, existing.rows[0].artifact_type],
        )
        const version = versionResult.rows[0].next
        const inserted = await client.query(
          `INSERT INTO public.quote_artifacts
             (quote_request_id, artifact_type, title, content, format, version, generated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, version`,
          [request.params.id, existing.rows[0].artifact_type, existing.rows[0].title,
           content, existing.rows[0].format, version, `edited-by:${request.adminActor}`],
        )
        await client.query(
          `UPDATE public.quote_requests SET status = 'ready_for_review'
           WHERE id = $1 AND status IN ('ready_for_review', 'rejected', 'needs_clarification')`,
          [request.params.id],
        )
        await recordAudit(client, request.params.id, request.adminActor, 'artifact.edited',
          existing.rows[0].artifact_type, { fromVersion: existing.rows[0].version, toVersion: version })
        await client.query('COMMIT')
        response.json({ ok: true, artifactId: inserted.rows[0].id, version })
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    } catch (error) {
      next(error)
    }
  })

  // ---- regenerate one artifact via the engine (new version) ----
  router.post('/requests/:id/regenerate', requireAuth, requirePool, async (request, response, next) => {
    try {
      const artifactType = request.body?.type
      if (typeof artifactType !== 'string' || !artifactType) {
        fail(response, 400, 'An artifact type is required.')
        return
      }
      const result = await workflow.regenerateArtifact(request.params.id, artifactType, request.adminActor)
      if (!result.ok) {
        const statuses = { 'request-not-found': 404, 'request-approved': 409, 'unknown-artifact-type': 400 }
        fail(response, statuses[result.reason] || 500, result.reason)
        return
      }
      response.json(result)
    } catch (error) {
      next(error)
    }
  })

  // ---- retry a failed workflow ----
  router.post('/requests/:id/retry', requireAuth, requirePool, async (request, response, next) => {
    try {
      const result = await workflow.retryFailed(request.params.id, request.adminActor)
      if (!result.ok) {
        const statuses = { 'request-not-found': 404, 'not-failed': 409 }
        fail(response, statuses[result.reason] || 500, result.reason)
        return
      }
      await pool.query(
        `INSERT INTO public.quote_audit_events (quote_request_id, actor, action, detail)
         VALUES ($1, $2, 'workflow.retried', $3)`,
        [request.params.id, request.adminActor, JSON.stringify({ status: result.status })],
      )
      response.json(result)
    } catch (error) {
      next(error)
    }
  })

  // ---- assignment ----
  router.post('/requests/:id/assign', requireAuth, requirePool, async (request, response, next) => {
    try {
      const assignee = typeof request.body?.assignee === 'string' ? request.body.assignee.trim().slice(0, 100) : ''
      if (!assignee) {
        fail(response, 400, 'An assignee name is required.')
        return
      }
      await pool.query('UPDATE public.quote_requests SET assigned_to = $2 WHERE id = $1', [request.params.id, assignee])
      await recordAudit(pool, request.params.id, request.adminActor, 'request.assigned', 'quote_requests', { assignee })
      response.json({ ok: true, assignee })
    } catch (error) {
      next(error)
    }
  })

  // ---- approval gate ----
  router.post('/requests/:id/approve', requireAuth, requirePool, async (request, response, next) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const requestResult = await client.query(
        'SELECT id, status, public_reference FROM public.quote_requests WHERE id = $1 FOR UPDATE',
        [request.params.id],
      )
      if (requestResult.rowCount === 0) {
        await client.query('ROLLBACK')
        fail(response, 404, 'Request not found.')
        return
      }
      if (requestResult.rows[0].status === 'approved') {
        await client.query('ROLLBACK')
        fail(response, 409, 'Pack is already approved.')
        return
      }

      const latest = await loadLatestArtifactsByType(client, request.params.id)
      const present = new Set(latest.map((a) => a.artifact_type))
      const missing = REQUIRED_ARTIFACTS.filter((type) => !present.has(type))
      if (missing.length > 0) {
        await client.query('ROLLBACK')
        fail(response, 409, `Pack cannot be approved until required artifacts exist: ${missing.join(', ')}.`)
        return
      }

      const approvedVersions = {}
      for (const artifact of latest) {
        await client.query(
          `UPDATE public.quote_artifacts
           SET approval_status = 'approved', approved_by = $2, approved_at = now()
           WHERE id = $1`,
          [artifact.id, request.adminActor],
        )
        approvedVersions[artifact.artifact_type] = artifact.version
      }
      await client.query(
        "UPDATE public.quote_requests SET status = 'approved' WHERE id = $1",
        [request.params.id],
      )
      await recordAudit(client, request.params.id, request.adminActor, 'pack.approved', 'quote_requests', {
        reference: requestResult.rows[0].public_reference,
        approvedVersions,
        reason: typeof request.body?.reason === 'string' ? request.body.reason.slice(0, 1000) : null,
      })
      await client.query('COMMIT')
      response.json({ ok: true, approvedVersions })
    } catch (error) {
      await client.query('ROLLBACK')
      next(error)
    } finally {
      client.release()
    }
  })

  router.post('/requests/:id/reject', requireAuth, requirePool, async (request, response, next) => {
    try {
      const reason = typeof request.body?.reason === 'string' && request.body.reason.trim()
        ? request.body.reason.trim().slice(0, 1000)
        : null
      if (!reason) {
        fail(response, 400, 'A rejection reason is required.')
        return
      }
      const result = await pool.query(
        `UPDATE public.quote_requests SET status = 'rejected'
         WHERE id = $1 AND status NOT IN ('approved') RETURNING public_reference`,
        [request.params.id],
      )
      if (result.rowCount === 0) {
        fail(response, 409, 'Request cannot be rejected from its current state.')
        return
      }
      await recordAudit(pool, request.params.id, request.adminActor, 'pack.rejected', 'quote_requests', { reason })
      response.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  // ---- single artifact download ----
  router.get('/requests/:id/artifacts/:artifactId/download', requireAuth, requirePool, async (request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT artifact_type, title, content, format FROM public.quote_artifacts
         WHERE id = $1 AND quote_request_id = $2`,
        [request.params.artifactId, request.params.id],
      )
      if (result.rowCount === 0) {
        fail(response, 404, 'Artifact not found.')
        return
      }
      const artifact = result.rows[0]
      response.setHeader('Content-Type', artifact.format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8')
      response.setHeader('Content-Disposition', `attachment; filename="${artifactFileName(artifact)}"`)
      response.send(artifact.content)
    } catch (error) {
      next(error)
    }
  })

  // ---- full ZIP export ----
  router.get('/requests/:id/export', requireAuth, requirePool, async (request, response, next) => {
    try {
      const { default: archiver } = await import('archiver')
      const requestResult = await pool.query(
        'SELECT id, public_reference, status, created_at FROM public.quote_requests WHERE id = $1',
        [request.params.id],
      )
      if (requestResult.rowCount === 0) {
        fail(response, 404, 'Request not found.')
        return
      }
      const quoteRequest = requestResult.rows[0]
      const artifacts = await loadLatestArtifactsByType(pool, request.params.id)
      const audit = await pool.query(
        `SELECT actor, action, entity, detail, created_at
         FROM public.quote_audit_events
         WHERE quote_request_id = $1 ORDER BY created_at ASC`,
        [request.params.id],
      )

      const reference = quoteRequest.public_reference || quoteRequest.id
      const manifest = {
        requestId: quoteRequest.id,
        publicReference: reference,
        exportedAt: new Date().toISOString(),
        requestStatus: quoteRequest.status,
        files: artifacts.map((artifact) => ({
          path: `${ARTIFACT_FOLDERS[artifact.artifact_type] || '07-admin'}/${artifactFileName(artifact)}`,
          type: artifact.artifact_type,
          version: artifact.version,
          generatedBy: artifact.generated_by,
          approvalStatus: artifact.approval_status,
          createdAt: artifact.created_at,
          internalOnly: artifact.artifact_type === 'estimate-internal',
        })),
        omitted: ['07-admin/admin-decision.md (authored by admins; not generated)'],
        note: 'estimate-internal.md is internal-only and must never be sent to clients.',
      }

      response.setHeader('Content-Type', 'application/zip')
      response.setHeader('Content-Disposition', `attachment; filename="${reference}-production-pack.zip"`)
      const archive = archiver('zip', { zlib: { level: 9 } })
      archive.on('error', (error) => {
        response.destroy()
        next(error)
      })
      archive.pipe(response)
      for (const artifact of artifacts) {
        const folder = ARTIFACT_FOLDERS[artifact.artifact_type] || '07-admin'
        archive.append(artifact.content, { name: `${reference}/${folder}/${artifactFileName(artifact)}` })
      }
      archive.append(JSON.stringify(manifest, null, 2), { name: `${reference}/artifact-manifest.json` })
      const auditSummary = [
        `# Audit summary — ${reference}`,
        '',
        ...audit.rows.map((event) => `- ${event.created_at} — ${event.actor} — ${event.action}${event.entity ? ` (${event.entity})` : ''} ${event.detail && Object.keys(event.detail).length ? JSON.stringify(event.detail) : ''}`),
      ].join('\n')
      archive.append(auditSummary, { name: `${reference}/07-admin/audit-summary.md` })
      await archive.finalize()
    } catch (error) {
      next(error)
    }
  })

  // ---- overview counts ----
  router.get('/overview', requireAuth, requirePool, async (_request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT status, COUNT(*)::int AS count FROM public.quote_requests GROUP BY status`,
      )
      const counts = {}
      for (const row of result.rows) counts[row.status] = row.count
      const recent = await pool.query(
        `SELECT actor, action, quote_request_id, created_at
         FROM public.quote_audit_events
         ORDER BY created_at DESC LIMIT 12`,
      )
      response.json({ counts, recentActivity: recent.rows })
    } catch (error) {
      next(error)
    }
  })

  router.use((_request, response) => {
    fail(response, 404, 'Admin API route not found.')
  })

  router.use((error, _request, response, _next) => {
    if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
      fail(response, 400, 'The request body is invalid.')
      return
    }
    console.error('Admin API error:', error?.message || error)
    fail(response, 500, 'Unexpected admin server error.')
  })

  return router
}
