/*
# Create app_config table
*/
CREATE TABLE IF NOT EXISTS app_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
INSERT INTO app_config (key, value) VALUES ('master_email', 'healthcareatul@gmail.com') ON CONFLICT (key) DO NOTHING;
