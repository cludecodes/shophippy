-- QuoteRequest.updated_at (workflow state changes should be traceable).

ALTER TABLE public.quote_requests
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.quote_requests_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quote_requests_updated_at_trigger ON public.quote_requests;

CREATE TRIGGER quote_requests_updated_at_trigger
  BEFORE UPDATE ON public.quote_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.quote_requests_touch_updated_at();
