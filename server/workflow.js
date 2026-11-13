// Workflow orchestrator (skills.md Skill 00 / 13, adapted to this stack).
//
// Vercel serverless functions cannot host durable background queues without
// extra infrastructure, and this rule-based engine completes in milliseconds,
// so the workflow runs synchronously at submission time — server-side, never
// in the browser. Every run is idempotent: a request that already has artifacts
// is never re-processed during submission. Errors are captured per skill into
// agent_runs and the request status becomes 'failed', which admins can retry.

export function createWorkflow({ pool, generatePack }) {
  async function runAgentRun(client, requestId, skillName, work) {
    const started = await client.query(
      `INSERT INTO public.quote_agent_runs (quote_request_id, skill_name, status)
       VALUES ($1, $2, 'running') RETURNING id`,
      [requestId, skillName],
    )
    try {
      const outputs = await work(client)
      await client.query(
        `UPDATE public.quote_agent_runs
         SET status = 'completed', completed_at = now()
         WHERE id = $1`,
        [started.rows[0].id],
      )
      return outputs
    } catch (error) {
      // Sanitized: message only, never query text or data values.
      await client.query(
        `UPDATE public.quote_agent_runs
         SET status = 'failed', completed_at = now(),
             error_summary = $2
         WHERE id = $1`,
        [started.rows[0].id, String(error?.message || 'unknown error').slice(0, 500)],
      )
      throw error
    }
  }

  // Called by the quote submission route after the request row is stored.
  async function processNewQuote(requestId) {
    if (!pool) return { ok: false, reason: 'database-not-configured' }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Idempotency: another run may have completed this already.
      const existing = await client.query(
        'SELECT status FROM public.quote_requests WHERE id = $1 FOR UPDATE',
        [requestId],
      )
      if (existing.rowCount === 0) {
        await client.query('ROLLBACK')
        return { ok: false, reason: 'request-not-found' }
      }
      const currentStatus = existing.rows[0].status
      if (currentStatus !== 'new' && currentStatus !== 'failed') {
        await client.query('COMMIT')
        return { ok: true, alreadyProcessed: true }
      }

      await client.query(
        "UPDATE public.quote_requests SET status = 'processing' WHERE id = $1",
        [requestId],
      )

      const pack = await runAgentRun(client, requestId, 'quote-to-pack', async (tx) => {
        const quoteResult = await tx.query('SELECT * FROM public.quote_requests WHERE id = $1', [requestId])
        const row = quoteResult.rows[0]
        const quote = {
          id: row.id,
          publicReference: row.public_reference,
          projectType: row.project_type,
          fullName: row.full_name,
          email: row.email,
          phone: row.phone,
          country: row.country,
          company: row.company,
          currency: row.currency,
          budgetRange: row.budget_range,
          details: row.details,
          contactConsent: row.contact_consent,
          formData: row.form_data,
          rawSubmission: row.raw_submission,
          createdAt: row.created_at,
        }
        const generated = generatePack(quote)
        for (const artifact of generated.artifacts) {
          await tx.query(
            `INSERT INTO public.quote_artifacts
               (quote_request_id, artifact_type, title, content, format, version, generated_by)
             VALUES ($1, $2, $3, $4, $5, 1, 'rule-engine-v1')`,
            [requestId, artifact.type, artifact.title, artifact.content, artifact.format],
          )
        }
        return { artifactCount: generated.artifacts.length, analysis: generated.analysis }
      })

      // Clarification gate: if the intake produced open questions that block
      // scope (missing timeline or empty requirements), pause for clarification.
      const missingCritical = pack.analysis.questions.some(
        (q) => q.priority === 'high' && /timeline/i.test(q.question),
      ) || pack.analysis.requirements.length === 0

      const newStatus = missingCritical ? 'needs_clarification' : 'ready_for_review'
      await client.query(
        'UPDATE public.quote_requests SET status = $2 WHERE id = $1',
        [requestId, newStatus],
      )

      await client.query(
        `INSERT INTO public.quote_audit_events (quote_request_id, actor, action, entity, detail)
         VALUES ($1, 'system', 'workflow.completed', 'quote_requests', $2)`,
        [requestId, JSON.stringify({
          status: newStatus,
          artifacts: pack.artifactCount,
          category: pack.analysis.category,
        })],
      )

      await client.query('COMMIT')
      return { ok: true, status: newStatus, artifacts: pack.artifactCount }
    } catch (error) {
      try {
        await client.query('ROLLBACK')
        await client.query(
          "UPDATE public.quote_requests SET status = 'failed' WHERE id = $1 AND status IN ('new', 'processing')",
          [requestId],
        )
        await client.query(
          `INSERT INTO public.quote_audit_events (quote_request_id, actor, action, detail)
           VALUES ($1, 'system', 'workflow.failed', $2)`,
          [requestId, JSON.stringify({ reason: String(error?.message || 'unknown').slice(0, 300) })],
        )
      } catch {
        // Secondary failure while recording the failure: nothing safe to do.
      }
      return { ok: false, reason: 'processing-failed' }
    } finally {
      client.release()
    }
  }

  // Regenerate one artifact type as a NEW version (never overwrites).
  async function regenerateArtifact(requestId, artifactType, actor) {
    if (!pool) return { ok: false, reason: 'database-not-configured' }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const quoteResult = await client.query('SELECT * FROM public.quote_requests WHERE id = $1', [requestId])
      if (quoteResult.rowCount === 0) {
        await client.query('ROLLBACK')
        return { ok: false, reason: 'request-not-found' }
      }
      const row = quoteResult.rows[0]
      if (row.status === 'approved') {
        // Approved packs are preserved: regenerating any artifact would
        // desync the approved version set.
        await client.query('ROLLBACK')
        return { ok: false, reason: 'request-approved' }
      }

      const quote = {
        id: row.id,
        publicReference: row.public_reference,
        projectType: row.project_type,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        country: row.country,
        company: row.company,
        currency: row.currency,
        budgetRange: row.budget_range,
        details: row.details,
        contactConsent: row.contact_consent,
        formData: row.form_data,
        rawSubmission: row.raw_submission,
        createdAt: row.created_at,
      }
      const generated = generatePack(quote)
      const artifact = generated.artifacts.find((item) => item.type === artifactType)
      if (!artifact) {
        await client.query('ROLLBACK')
        return { ok: false, reason: 'unknown-artifact-type' }
      }

      const versionResult = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next
         FROM public.quote_artifacts
         WHERE quote_request_id = $1 AND artifact_type = $2`,
        [requestId, artifactType],
      )
      const version = versionResult.rows[0].next

      // An approved artifact being regenerated: keep approval on old versions,
      // the new version starts as pending.
      const inserted = await client.query(
        `INSERT INTO public.quote_artifacts
           (quote_request_id, artifact_type, title, content, format, version, generated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, version`,
        [requestId, artifact.type, artifact.title, artifact.content, artifact.format, version, `regenerated-by:${actor}`],
      )

      // Regeneration moves the request back to review; the old versions stay
      // in history for comparison and the audit log records the change.
      await client.query(
        `UPDATE public.quote_requests SET status = 'ready_for_review' WHERE id = $1 AND status IN ('ready_for_review', 'rejected', 'needs_clarification')`,
        [requestId],
      )

      await client.query(
        `INSERT INTO public.quote_audit_events (quote_request_id, actor, action, entity, detail)
         VALUES ($1, $2, 'artifact.regenerated', $3, $4)`,
        [requestId, actor, artifactType, JSON.stringify({ version: inserted.rows[0].version })],
      )

      await client.query('COMMIT')
      return { ok: true, artifactId: inserted.rows[0].id, version: inserted.rows[0].version }
    } catch (error) {
      await client.query('ROLLBACK')
      return { ok: false, reason: String(error?.message || 'processing-failed').slice(0, 200) }
    } finally {
      client.release()
    }
  }

  // Retry a request stuck in 'failed'.
  async function retryFailed(requestId, actor) {
    if (!pool) return { ok: false, reason: 'database-not-configured' }
    const client = await pool.connect()
    try {
      const status = await client.query('SELECT status FROM public.quote_requests WHERE id = $1', [requestId])
      if (status.rowCount === 0) return { ok: false, reason: 'request-not-found' }
      if (status.rows[0].status !== 'failed') return { ok: false, reason: 'not-failed' }
      await client.query('UPDATE public.quote_requests SET status = $2 WHERE id = $1', [requestId, 'new'])
      await client.query(
        `INSERT INTO public.quote_audit_events (quote_request_id, actor, action, detail)
         VALUES ($1, $2, 'workflow.retry', '{}')`,
        [requestId, actor],
      )
    } finally {
      client.release()
    }
    return processNewQuote(requestId)
  }

  return { processNewQuote, regenerateArtifact, retryFailed }
}
