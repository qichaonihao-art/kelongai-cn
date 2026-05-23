CREATE TABLE IF NOT EXISTS product_events (
  id TEXT PRIMARY KEY,
  anonymous_id TEXT,
  event_name TEXT NOT NULL,
  path TEXT,
  tool_type TEXT,
  platform TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_events_created ON product_events(created_at);
CREATE INDEX IF NOT EXISTS idx_product_events_name ON product_events(event_name);
CREATE INDEX IF NOT EXISTS idx_product_events_path ON product_events(path);
