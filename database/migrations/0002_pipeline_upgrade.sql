ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS daily_prospect_goal integer NOT NULL DEFAULT 5;

CREATE TABLE IF NOT EXISTS lifecycle_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  stage_key text,
  stage_order integer NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lifecycle_stages ADD COLUMN IF NOT EXISTS stage_key text;
CREATE INDEX IF NOT EXISTS lifecycle_stages_owner_idx ON lifecycle_stages(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS lifecycle_stages_owner_order_active_unique ON lifecycle_stages(owner_id, stage_order) WHERE archived_at IS NULL;

INSERT INTO lifecycle_stages(owner_id, name, stage_key, stage_order)
SELECT u.id, seed.name, seed.stage_key, seed.stage_order
FROM users u
CROSS JOIN (VALUES
  ('New', 'new', 1), ('Active', 'active', 2), ('Engaged', 'engaged', 3), ('Meeting Booked', 'meeting_booked', 4),
  ('Meeting Attended', 'meeting_attended', 5), ('Customer', 'customer', 6), ('Churned', 'churned', 7)
) AS seed(name, stage_key, stage_order)
WHERE NOT EXISTS (SELECT 1 FROM lifecycle_stages s WHERE s.owner_id = u.id);

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS lifecycle_stage_id uuid REFERENCES lifecycle_stages(id) ON DELETE RESTRICT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS tracking_status text NOT NULL DEFAULT 'open';
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS last_interacted_at timestamptz;

UPDATE prospects p
SET lifecycle_stage_id = s.id
FROM lifecycle_stages s
WHERE s.owner_id = p.owner_id
  AND s.name = CASE
    WHEN p.workflow_status = 'new' THEN 'New'
    WHEN p.workflow_status = 'engaged' THEN 'Engaged'
    ELSE 'Active'
  END
  AND p.lifecycle_stage_id IS NULL;

ALTER TABLE prospects ALTER COLUMN lifecycle_stage_id SET NOT NULL;

UPDATE prospects SET tracking_status = CASE
  WHEN workflow_status = 'paused' THEN 'paused'
  WHEN workflow_status IN ('closed', 'no_response') THEN 'closed'
  ELSE 'open'
END;

DO $$ BEGIN
  ALTER TABLE prospects ADD CONSTRAINT prospects_tracking_status_check CHECK (tracking_status IN ('open','paused','closed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE prospects p SET last_interacted_at = a.last_at
FROM (
  SELECT prospect_id, max(occurred_at) AS last_at
  FROM activities
  WHERE type IN ('connection_request_sent','message_sent','reply_received','reply_sent')
  GROUP BY prospect_id
) a WHERE a.prospect_id = p.id AND p.last_interacted_at IS NULL;

CREATE INDEX IF NOT EXISTS prospects_owner_stage_idx ON prospects(owner_id, lifecycle_stage_id);

ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES lifecycle_stages(id) ON DELETE CASCADE;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'no_reply';

ALTER TABLE workflow_steps DROP CONSTRAINT IF EXISTS workflow_steps_workflow_id_step_order_key;
DROP INDEX IF EXISTS workflow_steps_order_unique;

UPDATE workflow_steps ws
SET stage_id = s.id,
    trigger_type = CASE WHEN ws.step_order = 1 THEN 'entry' ELSE 'no_reply' END,
    step_order = CASE WHEN ws.step_order = 1 THEN 1 ELSE ws.step_order - 1 END
FROM lifecycle_stages s
WHERE s.owner_id = ws.owner_id AND s.name = 'Active' AND ws.stage_id IS NULL;

ALTER TABLE workflow_steps ALTER COLUMN stage_id SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE workflow_steps ADD CONSTRAINT workflow_steps_trigger_type_check CHECK (trigger_type IN ('entry','reply','no_reply'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS workflow_steps_branch_order_unique ON workflow_steps(stage_id, trigger_type, step_order);

CREATE TABLE IF NOT EXISTS prospect_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES lifecycle_stages(id) ON DELETE RESTRICT,
  to_stage_id uuid NOT NULL REFERENCES lifecycle_stages(id) ON DELETE RESTRICT,
  reason text NOT NULL DEFAULT 'manual',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospect_stage_history_owner_time_idx ON prospect_stage_history(owner_id, occurred_at);
CREATE INDEX IF NOT EXISTS prospect_stage_history_prospect_time_idx ON prospect_stage_history(prospect_id, occurred_at);

INSERT INTO prospect_stage_history(owner_id, prospect_id, to_stage_id, reason, occurred_at)
SELECT p.owner_id, p.id, p.lifecycle_stage_id, 'migration_baseline', now()
FROM prospects p
WHERE p.lifecycle_stage_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM prospect_stage_history h WHERE h.prospect_id = p.id);
