CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  replit_user_id text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'America/New_York',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linkedin_url text NOT NULL,
  name text NOT NULL,
  job_title text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  company_size text NOT NULL DEFAULT 'Unknown',
  connection_status text NOT NULL DEFAULT 'not_connected' CHECK (connection_status IN ('not_connected','pending','connected')),
  workflow_status text NOT NULL DEFAULT 'new' CHECK (workflow_status IN ('new','active','engaged','paused','no_response','closed')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, linkedin_url)
);
CREATE INDEX IF NOT EXISTS prospects_owner_status_idx ON prospects(owner_id, workflow_status);

CREATE TABLE IF NOT EXISTS mutual_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  name text NOT NULL,
  linkedin_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mutual_contacts_prospect_idx ON mutual_contacts(prospect_id);

CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Trucea outreach',
  final_wait_business_days integer NOT NULL DEFAULT 5,
  is_default integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, is_default)
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('message','follow_up')),
  name text NOT NULL,
  delay_business_days integer NOT NULL DEFAULT 0,
  template text NOT NULL,
  UNIQUE(workflow_id, step_order)
);

CREATE TABLE IF NOT EXISTS scheduled_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  workflow_step_id uuid REFERENCES workflow_steps(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduled_actions_owner_due_idx ON scheduled_actions(owner_id, status, due_at);
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_actions_one_pending_per_prospect ON scheduled_actions(prospect_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  type text NOT NULL,
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_prospect_time_idx ON activities(prospect_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS extension_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS extension_tokens_owner_idx ON extension_tokens(owner_id);

CREATE TABLE IF NOT EXISTS sessions (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire);
