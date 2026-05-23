CREATE TABLE IF NOT EXISTS membership_plans (
  plan_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_label TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  billing_period TEXT NOT NULL,
  internal_credits INTEGER NOT NULL DEFAULT 0,
  daily_limit INTEGER NOT NULL DEFAULT 10,
  max_video_minutes INTEGER NOT NULL DEFAULT 10,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  badge TEXT,
  description TEXT,
  features_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO membership_plans (
  plan_key, name, price_label, price_cents, billing_period, internal_credits,
  daily_limit, max_video_minutes, enabled, sort_order, badge, description, features_json
) VALUES
  ('monthly', '月会员', '¥29/月', 2900, 'monthly', 3000, 100, 10, 1, 10, '', '适合日常短视频、图文和文章提取', '["常用平台内容提取","视频文案识别","图片和视频素材下载"]'),
  ('yearly', '年会员', '¥299/年', 29900, 'yearly', 36000, 300, 15, 1, 20, '推荐', '适合长期做内容的账号和运营人员', '["全年会员权益","更高使用额度","适合高频内容整理"]'),
  ('lifetime', '永久会员', '¥699', 69900, 'lifetime', 120000, 1000, 20, 1, 30, '', '适合长期使用 CopyPilot 的创作者', '["长期会员权益","优先支持新功能","适合工作室长期使用"]');
