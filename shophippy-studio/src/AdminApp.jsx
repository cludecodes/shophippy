import React, { useCallback, useEffect, useMemo, useState } from 'react'

const STATUS_LABELS = {
  new: 'New',
  queued: 'Queued',
  processing: 'Processing',
  needs_clarification: 'Needs clarification',
  ready_for_review: 'Ready for review',
  approved: 'Approved',
  rejected: 'Rejected',
  in_production: 'In production',
  qa: 'QA',
  completed: 'Completed',
  archived: 'Archived',
  failed: 'Failed',
}

const TAB_GROUPS = [
  { key: 'source', label: 'Original request', types: ['original-submission'] },
  { key: 'analysis', label: 'AI analysis', types: ['executive-summary', 'requirements-brief', 'requirements', 'client-questions'] },
  { key: 'solution', label: 'Scope & solution', types: ['solution-architecture', 'ux-plan', 'scope-of-work', 'deliverables'] },
  { key: 'estimate', label: 'Internal estimate', types: ['estimate-internal', 'assumptions-and-exclusions'] },
  { key: 'production', label: 'Production plan', types: ['production-plan', 'task-backlog'] },
  { key: 'prompts', label: 'Agent prompts', types: ['master-build-prompt', 'frontend-agent-prompt', 'backend-agent-prompt', 'database-agent-prompt', 'integration-agent-prompt', 'qa-agent-prompt', 'devops-agent-prompt', 'documentation-agent-prompt'] },
  { key: 'quality', label: 'QA & risks', types: ['qa-test-plan', 'risk-review', 'release-checklist'] },
]

const PROMPT_TYPES = TAB_GROUPS.find((group) => group.key === 'prompts').types

function StatusBadge({ status }) {
  return <span className={`admin-status admin-status-${status}`}>{STATUS_LABELS[status] || status}</span>
}

function CopyButton({ text, label = 'Copy', onDone }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
      onDone?.()
    } catch {
      // Clipboard unavailable (permissions/insecure context).
    }
  }
  return (
    <button className="admin-btn admin-btn-small" type="button" onClick={handleCopy}>
      {copied ? 'Copied!' : label}
    </button>
  )
}

function ArtifactCard({ artifact, allVersions, onEdit, onRegenerate, onSaved }) {
  const [view, setView] = useState('content') // content | history | edit
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const isApproved = artifact.approval_status === 'approved'
  const isInternal = artifact.artifact_type === 'estimate-internal'

  const startEdit = () => {
    setDraft(artifact.content)
    setView('edit')
    setError(null)
  }

  const saveEdit = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/requests/${artifact.quote_request_id}/artifacts/${artifact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Save failed')
      setView('content')
      onSaved?.()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  const regenerate = async () => {
    if (!window.confirm(`Regenerate "${artifact.title}"? A new version will be created; the current version stays in history.`)) return
    try {
      const response = await fetch(`/api/admin/requests/${artifact.quote_request_id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: artifact.artifact_type }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Regeneration failed')
      onSaved?.()
    } catch (regenError) {
      window.alert(regenError.message)
    }
  }

  return (
    <article className={`admin-artifact${isInternal ? ' admin-artifact-internal' : ''}`}>
      <header className="admin-artifact-head">
        <div>
          <h4>{artifact.title}</h4>
          <div className="admin-artifact-meta">
            v{artifact.version} · {artifact.generated_by} · {new Date(artifact.created_at).toLocaleString()}
            {isApproved && <span className="admin-approved-tag">approved</span>}
          </div>
          {isInternal && <div className="admin-internal-note">INTERNAL ONLY — never include in client-facing exports</div>}
        </div>
        <div className="admin-artifact-actions">
          <CopyButton text={artifact.content} />
          <a className="admin-btn admin-btn-small" href={`/api/admin/requests/${artifact.quote_request_id}/artifacts/${artifact.id}/download`}>Download</a>
          <button className="admin-btn admin-btn-small" type="button" onClick={() => setView(view === 'history' ? 'content' : 'history')}>
            History ({allVersions.length})
          </button>
          {!isApproved && (
            <>
              <button className="admin-btn admin-btn-small" type="button" onClick={startEdit}>Edit</button>
              <button className="admin-btn admin-btn-small" type="button" onClick={regenerate}>Regenerate</button>
            </>
          )}
        </div>
      </header>

      {view === 'content' && (
        <pre className="admin-artifact-content">{artifact.content}</pre>
      )}

      {view === 'edit' && (
        <div className="admin-artifact-editor">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={Math.min(28, Math.max(10, draft.split('\n').length + 2))}
          />
          {error && <div className="admin-error">{error}</div>}
          <div className="admin-artifact-editor-actions">
            <button className="admin-btn admin-btn-primary" type="button" disabled={saving} onClick={saveEdit}>
              {saving ? 'Saving…' : 'Save as new version'}
            </button>
            <button className="admin-btn" type="button" onClick={() => setView('content')}>Cancel</button>
          </div>
        </div>
      )}

      {view === 'history' && (
        <div className="admin-version-history">
          {allVersions.map((version) => (
            <details key={version.id}>
              <summary>
                v{version.version} · {version.generated_by} · {new Date(version.created_at).toLocaleString()}
                {version.approval_status === 'approved' && <span className="admin-approved-tag">approved</span>}
              </summary>
              <pre className="admin-artifact-content admin-artifact-content-small">{version.content}</pre>
              <CopyButton text={version.content} label="Copy this version" />
            </details>
          ))}
        </div>
      )}
    </article>
  )
}

function LoginView({ onAuthenticated }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Login failed')
      onAuthenticated()
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-login">
      <form className="admin-login-card" onSubmit={submit}>
        <h1>Shophippy Admin</h1>
        <p>Owner sign-in. Access is restricted and logged.</p>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Admin password"
          autoComplete="current-password"
          autoFocus
        />
        {error && <div className="admin-error">{error}</div>}
        <button className="admin-btn admin-btn-primary" type="submit" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

function OverviewView({ onOpenRequest }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/admin/overview')
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to load')
        return response.json()
      })
      .then(setData)
      .catch((loadError) => setError(loadError.message))
  }, [])

  if (error) return <div className="admin-error admin-pad">{error}</div>
  if (!data) return <div className="admin-pad admin-muted">Loading…</div>

  const trackedStatuses = ['new', 'processing', 'needs_clarification', 'ready_for_review', 'approved', 'failed']

  return (
    <div className="admin-pad">
      <h2>Overview</h2>
      <div className="admin-widgets">
        {trackedStatuses.map((status) => (
          <div className="admin-widget" key={status}>
            <span className="admin-widget-count">{data.counts[status] || 0}</span>
            <StatusBadge status={status} />
          </div>
        ))}
      </div>
      <h3>Recent activity</h3>
      {data.recentActivity.length === 0 ? (
        <p className="admin-muted">No activity yet. New quote requests will appear here.</p>
      ) : (
        <ul className="admin-activity">
          {data.recentActivity.map((event) => (
            <li key={event.id}>
              <span className="admin-muted">{new Date(event.created_at).toLocaleString()}</span>
              {' — '}
              <strong>{event.action}</strong>
              {' by '}
              {event.actor}
              {event.quote_request_id && (
                <>
                  {' — '}
                  <button className="admin-link" type="button" onClick={() => onOpenRequest(event.quote_request_id)}>
                    open request
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RequestsView({ onOpen }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) })
    if (search.trim()) params.set('q', search.trim())
    if (status) params.set('status', status)
    fetch(`/api/admin/requests?${params}`)
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to load requests')
        return response.json()
      })
      .then(setData)
      .catch((loadError) => setError(loadError.message))
  }, [page, search, status])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <div className="admin-error admin-pad">{error}</div>

  return (
    <div className="admin-pad">
      <h2>Quote requests</h2>
      <div className="admin-filters">
        <input
          value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1) }}
          placeholder="Search reference, client, email, project…"
        />
        <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {!data ? <p className="admin-muted">Loading…</p> : data.requests.length === 0 ? (
        <p className="admin-muted">No quote requests match. Submit one from the site to see the workflow run.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Client</th>
              <th>Project</th>
              <th>Status</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {data.requests.map((row) => (
              <tr key={row.id} onClick={() => onOpen(row.id)} className="admin-row-click">
                <td><strong>{row.public_reference || '—'}</strong></td>
                <td>{row.full_name}<div className="admin-muted">{row.email}</div></td>
                <td>{row.project_type}</td>
                <td><StatusBadge status={row.status} /></td>
                <td>{new Date(row.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data && data.total > data.pageSize && (
        <div className="admin-pagination">
          <button className="admin-btn" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="admin-muted">Page {data.page} of {Math.ceil(data.total / data.pageSize)} ({data.total} requests)</span>
          <button className="admin-btn" type="button" disabled={page >= Math.ceil(data.total / data.pageSize)} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  )
}

function RequestWorkspace({ requestId, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('source')
  const [actionError, setActionError] = useState(null)
  const [rejectMode, setRejectMode] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [assignee, setAssignee] = useState('')

  const load = useCallback(() => {
    fetch(`/api/admin/requests/${requestId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to load request')
        return response.json()
      })
      .then((loaded) => {
        setData(loaded)
        setAssignee(loaded.request.assigned_to || '')
      })
      .catch((loadError) => setError(loadError.message))
  }, [requestId])

  useEffect(() => {
    load()
  }, [load])

  const artifactsByType = useMemo(() => {
    const map = {}
    for (const artifact of data?.artifacts || []) {
      (map[artifact.artifact_type] ||= []).push(artifact)
    }
    for (const versions of Object.values(map)) {
      versions.sort((a, b) => b.version - a.version)
    }
    return map
  }, [data])

  const latestByType = useMemo(() => {
    const map = {}
    for (const [type, versions] of Object.entries(artifactsByType)) {
      map[type] = versions[0]
    }
    return map
  }, [artifactsByType])

  if (error) return <div className="admin-error admin-pad">{error} <button className="admin-link" type="button" onClick={onBack}>back</button></div>
  if (!data) return <div className="admin-pad admin-muted">Loading…</div>

  const request = data.request
  const status = request.status

  const postAction = async (path, body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    setActionError(null)
    try {
      const response = await fetch(`/api/admin/requests/${requestId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Action failed')
      setRejectMode(false)
      setRejectReason('')
      load()
    } catch (actionError_) {
      setActionError(actionError_.message)
    }
  }

  const copyAllPrompts = async () => {
    const prompts = PROMPT_TYPES
      .map((type) => latestByType[type])
      .filter(Boolean)
    const text = prompts
      .map((artifact) => `=== ${artifact.title} ===\n\n${artifact.content}`)
      .join('\n\n\n')
    try {
      await navigator.clipboard.writeText(text)
      window.alert(`Copied ${prompts.length} prompt(s) to the clipboard.`)
    } catch {
      window.alert('Clipboard is unavailable in this browser context. Copy prompts individually instead.')
    }
  }

  const exportZip = () => {
    window.location.href = `/api/admin/requests/${requestId}/export`
  }

  const availableTabs = TAB_GROUPS.filter((group) => group.types.some((type) => latestByType[type]))
  const tabs = [...availableTabs.map((group) => ({ key: group.key, label: group.label })), { key: 'activity', label: 'Activity' }]

  return (
    <div className="admin-pad">
      <button className="admin-link" type="button" onClick={onBack}>← All requests</button>

      <header className="admin-request-head">
        <div>
          <h2>{request.public_reference || requestId}</h2>
          <div className="admin-muted">
            {request.full_name} · {request.email} · {request.country}
            {request.company ? ` · ${request.company}` : ''} · received {new Date(request.created_at).toLocaleString()}
          </div>
        </div>
        <div className="admin-request-side">
          <StatusBadge status={status} />
          <div className="admin-assign">
            <input
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              placeholder="Assign to…"
              className="admin-assign-input"
            />
            <button
              className="admin-btn admin-btn-small"
              type="button"
              onClick={() => postAction('assign', { assignee })}
            >
              Assign
            </button>
          </div>
        </div>
      </header>

      <div className="admin-request-actions">
        <button className="admin-btn admin-btn-primary" type="button" disabled={status === 'approved'}
          onClick={() => postAction('approve', { reason: null }, 'Approve this pack? The exact artifact versions will be recorded in the audit log. Production cannot start before approval.')}>
          Approve pack
        </button>
        <button className="admin-btn" type="button" disabled={status === 'approved'} onClick={() => setRejectMode(!rejectMode)}>
          Reject
        </button>
        {status === 'failed' && (
          <button className="admin-btn" type="button" onClick={() => postAction('retry', {}, 'Retry the failed workflow?')}>
            Retry workflow
          </button>
        )}
        <button className="admin-btn" type="button" onClick={exportZip}>Download ZIP pack</button>
        <CopyButton text={request.details || ''} label="Copy client brief" />
      </div>

      {actionError && <div className="admin-error">{actionError}</div>}

      {rejectMode && (
        <div className="admin-reject-box">
          <textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Rejection reason (required, recorded in the audit log)"
            rows={3}
          />
          <button
            className="admin-btn admin-btn-danger"
            type="button"
            disabled={!rejectReason.trim()}
            onClick={() => postAction('reject', { reason: rejectReason })}
          >
            Confirm rejection
          </button>
        </div>
      )}

      {status === 'needs_clarification' && (
        <div className="admin-banner admin-banner-warn">
          This request needs clarification before pricing. Review the questions in "AI analysis" and the draft client message — sending requires explicit admin action.
        </div>
      )}
      {status === 'approved' && (
        <div className="admin-banner admin-banner-ok">
          Pack approved — the approved artifact versions are locked and recorded in the audit log. Prompts can now be handed to production agents.
        </div>
      )}
      {status === 'failed' && (
        <div className="admin-banner admin-banner-warn">
          Workflow processing failed. Retry the workflow; completed partial outputs are preserved.
        </div>
      )}

      <nav className="admin-tabs">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`admin-tab${tab === item.key ? ' admin-tab-active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'activity' ? (
        <div className="admin-activity-grid">
          <section>
            <h3>Agent runs</h3>
            {data.agentRuns.length === 0 ? <p className="admin-muted">No runs recorded.</p> : (
              <ul className="admin-activity">
                {data.agentRuns.map((run) => (
                  <li key={run.id}>
                    <strong>{run.skill_name}</strong> — <StatusBadge status={run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'failed' : 'processing'} />
                    <div className="admin-muted">
                      {new Date(run.started_at).toLocaleString()}
                      {run.completed_at ? ` → ${new Date(run.completed_at).toLocaleTimeString()}` : ''}
                      {run.error_summary ? ` · error: ${run.error_summary}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>Audit events</h3>
            <ul className="admin-activity">
              {data.auditEvents.map((event) => (
                <li key={event.id}>
                  <strong>{event.action}</strong> by {event.actor}
                  <div className="admin-muted">
                    {new Date(event.created_at).toLocaleString()}
                    {event.detail && Object.keys(event.detail).length > 0 ? ` · ${JSON.stringify(event.detail)}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        (() => {
          const group = TAB_GROUPS.find((item) => item.key === tab)
          if (tab === 'prompts') {
            const prompts = PROMPT_TYPES.map((type) => latestByType[type]).filter(Boolean)
            return (
              <div>
                <div className="admin-prompts-toolbar">
                  <button className="admin-btn" type="button" onClick={copyAllPrompts} disabled={prompts.length === 0}>
                    Copy all applicable prompts ({prompts.length})
                  </button>
                </div>
                {prompts.map((artifact) => (
                  <ArtifactCard
                    key={artifact.id}
                    artifact={artifact}
                    allVersions={artifactsByType[artifact.artifact_type]}
                    onSaved={load}
                  />
                ))}
              </div>
            )
          }
          const present = group.types.map((type) => latestByType[type]).filter(Boolean)
          if (present.length === 0) {
            return <p className="admin-muted">No artifacts in this section.</p>
          }
          return present.map((artifact) => (
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              allVersions={artifactsByType[artifact.artifact_type]}
              onSaved={load}
            />
          ))
        })()
      )}
    </div>
  )
}

export default function AdminApp() {
  const [authed, setAuthed] = useState(null) // null = checking
  const [view, setView] = useState({ page: 'overview', requestId: null })

  useEffect(() => {
    fetch('/api/admin/session')
      .then((response) => setAuthed(response.ok))
      .catch(() => setAuthed(false))
  }, [])

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' })
    setAuthed(false)
    setView({ page: 'overview', requestId: null })
  }

  if (authed === null) {
    return <div className="admin-pad admin-muted">Checking session…</div>
  }

  if (!authed) {
    return <LoginView onAuthenticated={() => setAuthed(true)} />
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <strong className="admin-brand">Shophippy Admin</strong>
        <nav>
          <button
            className={`admin-nav-btn${view.page === 'overview' && !view.requestId ? ' admin-nav-active' : ''}`}
            type="button"
            onClick={() => setView({ page: 'overview', requestId: null })}
          >
            Overview
          </button>
          <button
            className={`admin-nav-btn${view.page === 'requests' ? ' admin-nav-active' : ''}`}
            type="button"
            onClick={() => setView({ page: 'requests', requestId: null })}
          >
            Quote requests
          </button>
        </nav>
        <button className="admin-btn admin-btn-small" type="button" onClick={logout}>Sign out</button>
      </header>

      <main>
        {view.requestId ? (
          <RequestWorkspace
            requestId={view.requestId}
            onBack={() => setView({ page: 'requests', requestId: null })}
          />
        ) : view.page === 'requests' ? (
          <RequestsView onOpen={(requestId) => setView({ page: 'requests', requestId })} />
        ) : (
          <OverviewView onOpenRequest={(requestId) => setView({ page: 'requests', requestId })} />
        )}
      </main>
    </div>
  )
}
