const DEFAULT_MEMBERSHIP_PLANS = [
  {
    plan_key: 'monthly',
    name: '月会员',
    price_label: '¥29/月',
    price_cents: 2900,
    billing_period: 'monthly',
    internal_credits: 3000,
    daily_limit: 100,
    max_video_minutes: 10,
    enabled: 1,
    sort_order: 10,
    badge: '',
    description: '适合日常短视频、图文和文章提取',
    features: ['常用平台内容提取', '视频文案识别', '图片和视频素材下载']
  },
  {
    plan_key: 'yearly',
    name: '年会员',
    price_label: '¥299/年',
    price_cents: 29900,
    billing_period: 'yearly',
    internal_credits: 36000,
    daily_limit: 300,
    max_video_minutes: 15,
    enabled: 1,
    sort_order: 20,
    badge: '推荐',
    description: '适合长期做内容的账号和运营人员',
    features: ['全年会员权益', '更高使用额度', '适合高频内容整理']
  },
  {
    plan_key: 'lifetime',
    name: '永久会员',
    price_label: '¥699',
    price_cents: 69900,
    billing_period: 'lifetime',
    internal_credits: 120000,
    daily_limit: 1000,
    max_video_minutes: 20,
    enabled: 1,
    sort_order: 30,
    badge: '',
    description: '适合长期使用 CopyPilot 的创作者',
    features: ['长期会员权益', '优先支持新功能', '适合工作室长期使用']
  }
];

export async function ensureMembershipPlans(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS membership_plans (
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
    )`
  ).run();

  for (const plan of DEFAULT_MEMBERSHIP_PLANS) {
    await db.prepare(
      `INSERT OR IGNORE INTO membership_plans (
        plan_key, name, price_label, price_cents, billing_period, internal_credits,
        daily_limit, max_video_minutes, enabled, sort_order, badge, description, features_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      plan.plan_key,
      plan.name,
      plan.price_label,
      plan.price_cents,
      plan.billing_period,
      plan.internal_credits,
      plan.daily_limit,
      plan.max_video_minutes,
      plan.enabled,
      plan.sort_order,
      plan.badge,
      plan.description,
      JSON.stringify(plan.features)
    ).run();
  }
}

export async function listMembershipPlans(db, { enabledOnly = false } = {}) {
  await ensureMembershipPlans(db);
  const where = enabledOnly ? 'WHERE enabled = 1' : '';
  const rows = await db.prepare(
    `SELECT * FROM membership_plans ${where} ORDER BY sort_order ASC, created_at ASC`
  ).all();
  return (rows.results || []).map(normalizePlanRow);
}

export async function getMembershipPlan(db, planKey) {
  await ensureMembershipPlans(db);
  const key = planKey === 'pro' ? 'monthly' : String(planKey || '').toLowerCase();
  if (!key || key === 'free' || key === 'admin') return null;
  const row = await db.prepare('SELECT * FROM membership_plans WHERE plan_key = ?').bind(key).first();
  return row ? normalizePlanRow(row) : null;
}

export async function upsertMembershipPlan(db, input) {
  await ensureMembershipPlans(db);
  const plan = normalizePlanInput(input);
  await db.prepare(
    `INSERT INTO membership_plans (
      plan_key, name, price_label, price_cents, billing_period, internal_credits,
      daily_limit, max_video_minutes, enabled, sort_order, badge, description, features_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(plan_key) DO UPDATE SET
      name = excluded.name,
      price_label = excluded.price_label,
      price_cents = excluded.price_cents,
      billing_period = excluded.billing_period,
      internal_credits = excluded.internal_credits,
      daily_limit = excluded.daily_limit,
      max_video_minutes = excluded.max_video_minutes,
      enabled = excluded.enabled,
      sort_order = excluded.sort_order,
      badge = excluded.badge,
      description = excluded.description,
      features_json = excluded.features_json,
      updated_at = CURRENT_TIMESTAMP`
  ).bind(
    plan.plan_key,
    plan.name,
    plan.price_label,
    plan.price_cents,
    plan.billing_period,
    plan.internal_credits,
    plan.daily_limit,
    plan.max_video_minutes,
    plan.enabled,
    plan.sort_order,
    plan.badge,
    plan.description,
    JSON.stringify(plan.features)
  ).run();
  return getMembershipPlan(db, plan.plan_key);
}

export function getDefaultPlanLimit(plan) {
  if (plan === 'monthly' || plan === 'pro') return 100;
  if (plan === 'yearly') return 300;
  if (plan === 'lifetime' || plan === 'admin') return 1000;
  return 10;
}

export function getDefaultMaxVideoMinutes(plan) {
  if (plan === 'yearly') return 15;
  if (plan === 'lifetime' || plan === 'admin') return 20;
  return 10;
}

function normalizePlanRow(row) {
  return {
    planKey: row.plan_key,
    name: row.name,
    priceLabel: row.price_label,
    priceCents: Number(row.price_cents || 0),
    billingPeriod: row.billing_period,
    internalCredits: Number(row.internal_credits || 0),
    dailyLimit: Number(row.daily_limit || 0),
    maxVideoMinutes: Number(row.max_video_minutes || 10),
    enabled: Boolean(row.enabled),
    sortOrder: Number(row.sort_order || 0),
    badge: row.badge || '',
    description: row.description || '',
    features: parseFeatures(row.features_json),
    updatedAt: row.updated_at
  };
}

function normalizePlanInput(input) {
  const planKey = String(input?.planKey || input?.plan_key || '').trim().toLowerCase();
  if (!['monthly', 'yearly', 'lifetime'].includes(planKey)) {
    throw new Error('套餐类型不正确。');
  }
  const features = Array.isArray(input.features)
    ? input.features.map((item) => String(item || '').trim()).filter(Boolean)
    : String(input.featuresText || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);

  return {
    plan_key: planKey,
    name: String(input.name || '').trim() || defaultName(planKey),
    price_label: String(input.priceLabel || input.price_label || '').trim() || defaultPrice(planKey),
    price_cents: clampInt(input.priceCents ?? input.price_cents, 0, 10000000),
    billing_period: normalizeBillingPeriod(input.billingPeriod || input.billing_period || planKey),
    internal_credits: clampInt(input.internalCredits ?? input.internal_credits, 0, 100000000),
    daily_limit: clampInt(input.dailyLimit ?? input.daily_limit, 1, 100000),
    max_video_minutes: clampInt(input.maxVideoMinutes ?? input.max_video_minutes, 1, 240),
    enabled: input.enabled === false || input.enabled === 0 ? 0 : 1,
    sort_order: clampInt(input.sortOrder ?? input.sort_order, 0, 100000),
    badge: String(input.badge || '').trim(),
    description: String(input.description || '').trim(),
    features
  };
}

function parseFeatures(value) {
  try {
    const list = JSON.parse(value || '[]');
    return Array.isArray(list) ? list.map((item) => String(item || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeBillingPeriod(value) {
  const period = String(value || '').trim().toLowerCase();
  if (['monthly', 'yearly', 'lifetime'].includes(period)) return period;
  return 'monthly';
}

function clampInt(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(Math.round(number), max));
}

function defaultName(planKey) {
  if (planKey === 'yearly') return '年会员';
  if (planKey === 'lifetime') return '永久会员';
  return '月会员';
}

function defaultPrice(planKey) {
  if (planKey === 'yearly') return '¥299/年';
  if (planKey === 'lifetime') return '¥699';
  return '¥29/月';
}
