CREATE TABLE IF NOT EXISTS public.quote_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_type text NOT NULL CHECK (char_length(project_type) BETWEEN 1 AND 100),
  full_name text NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 200),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  phone text NOT NULL CHECK (char_length(phone) BETWEEN 1 AND 50),
  country text NOT NULL CHECK (char_length(country) BETWEEN 1 AND 100),
  company text CHECK (company IS NULL OR char_length(company) <= 200),
  currency text NOT NULL CHECK (currency IN ('USD', 'PKR')),
  budget_range text NOT NULL CHECK (char_length(budget_range) BETWEEN 1 AND 100),
  details text NOT NULL CHECK (char_length(details) BETWEEN 15 AND 5000),
  contact_consent boolean NOT NULL CHECK (contact_consent),
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.quote_requests FROM PUBLIC;
