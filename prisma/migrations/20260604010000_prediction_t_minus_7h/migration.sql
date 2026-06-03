-- Rename the former automatic T-24h prediction version to T-7h.
-- Existing rows keep their semantic role as the automatic pre-match analysis.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PredictionVersion' AND e.enumlabel = 'T_MINUS_24H'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PredictionVersion' AND e.enumlabel = 'T_MINUS_7H'
  ) THEN
    ALTER TYPE "PredictionVersion" RENAME VALUE 'T_MINUS_24H' TO 'T_MINUS_7H';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PredictionVersion' AND e.enumlabel = 'T_MINUS_7H'
  ) THEN
    UPDATE "PredictionTask"
    SET "version" = 'T_MINUS_7H'::"PredictionVersion"
    WHERE "version"::text = 'T_MINUS_24H';
  END IF;
END $$;
