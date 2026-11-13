-- Quote-to-production workflow: workflow columns, versioned artifacts,
-- agent runs, and append-only audit events.

ALTER TABLE public.quote_requests
  ADD COLUMN IF NOT EXISTS public_reference text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS raw_submission jsonb,
  ADD COLUMN IF NOT EXISTS assigned_to text;

CREATE UNIQUE INDEX IF NOT EXISTS quote_requests_public_reference_key
  ON public.quote_requests(public_reference)
  WHERE public_reference IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quote_requests'::regclass
      AND conname = 'quote_requests_status_check'
  ) THEN
    ALTER TABLE public.quote_requests
      ADD CONSTRAINT quote_requests_status_check
      CHECK (status IN (
        'new', 'queued', 'processing', 'needs_clarification', 'ready_for_review',
        'approved', 'rejected', 'in_production', 'qa', 'completed', 'archived', 'failed'
      ));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.quote_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id uuid NOT NULL REFERENCES public.quote_requests(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK (char_length(artifact_type) BETWEEN 1 AND 100),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  content text NOT NULL,
  format text NOT NULL DEFAULT 'markdown' CHECK (format IN ('markdown', 'json', 'mermaid', 'text')),
  version integer NOT NULL DEFAULT 1,
  generated_by text NOT NULL DEFAULT 'rule-engine',
  created_at timestamptz NOT NULL DEFAULT now(),
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved')),
  approved_by text,
  approved_at timestamptz
);

CREATE INDEX IF NOT EXISTS quote_artifacts_request_idx
  ON public.quote_artifacts(quote_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS quote_artifacts_request_type_version_key
  ON public.quote_artifacts(quote_request_id, artifact_type, version);

CREATE TABLE IF NOT EXISTS public.quote_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id uuid NOT NULL REFERENCES public.quote_requests(id) ON DELETE CASCADE,
  skill_name text NOT NULL CHECK (char_length(skill_name) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  error_summary text
);

CREATE INDEX IF NOT EXISTS quote_agent_runs_request_idx
  ON public.quote_agent_runs(quote_request_id);

CREATE TABLE IF NOT EXISTS public.quote_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id uuid REFERENCES public.quote_requests(id) ON DELETE SET NULL,
  actor text NOT NULL,
  action text NOT NULL,
  entity text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_audit_events_request_idx
  ON public.quote_audit_events(quote_request_id);

-- Backfill legacy rows that predate the workflow columns.
UPDATE public.quote_requests
SET public_reference = 'SH-' || upper(replace(substring(id::text from 1 for 8), '-', ''))
WHERE public_reference IS NULL;

UPDATE public.quote_requests
SET raw_submission = jsonb_build_object(
  'projectType', project_type,
  'fullName', full_name,
  'email', email,
  'phone', phone,
  'country', country,
  'company', company,
  'currency', currency,
  'budgetRange', budget_range,
  'details', details,
  'contactConsent', contact_consent,
  'formData', form_data
)
WHERE raw_submission IS NULL;

REVOKE ALL ON TABLE public.quote_artifacts FROM PUBLIC;
REVOKE ALL ON TABLE public.quote_agent_runs FROM PUBLIC;
REVOKE ALL ON TABLE public.quote_audit_events FROM PUBLIC;
