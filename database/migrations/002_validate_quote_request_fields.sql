DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quote_requests'::regclass
      AND conname = 'quote_requests_project_type_check'
  ) THEN
    ALTER TABLE public.quote_requests
      ADD CONSTRAINT quote_requests_project_type_check
      CHECK (char_length(project_type) BETWEEN 1 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quote_requests'::regclass
      AND conname = 'quote_requests_full_name_check'
  ) THEN
    ALTER TABLE public.quote_requests
      ADD CONSTRAINT quote_requests_full_name_check
      CHECK (char_length(full_name) BETWEEN 1 AND 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quote_requests'::regclass
      AND conname = 'quote_requests_email_check'
  ) THEN
    ALTER TABLE public.quote_requests
      ADD CONSTRAINT quote_requests_email_check
      CHECK (char_length(email) BETWEEN 3 AND 320);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quote_requests'::regclass
      AND conname = 'quote_requests_phone_check'
  ) THEN
    ALTER TABLE public.quote_requests
      ADD CONSTRAINT quote_requests_phone_check
      CHECK (char_length(phone) BETWEEN 1 AND 50);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quote_requests'::regclass
      AND conname = 'quote_requests_country_check'
  ) THEN
    ALTER TABLE public.quote_requests
      ADD CONSTRAINT quote_requests_country_check
      CHECK (char_length(country) BETWEEN 1 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quote_requests'::regclass
      AND conname = 'quote_requests_company_check'
  ) THEN
    ALTER TABLE public.quote_requests
      ADD CONSTRAINT quote_requests_company_check
      CHECK (company IS NULL OR char_length(company) <= 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quote_requests'::regclass
      AND conname = 'quote_requests_budget_range_check'
  ) THEN
    ALTER TABLE public.quote_requests
      ADD CONSTRAINT quote_requests_budget_range_check
      CHECK (char_length(budget_range) BETWEEN 1 AND 100);
  END IF;
END;
$$;
