import { json } from '../_tikhub.js';
import { listMembershipPlans } from '../_plans.js';

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return json({ ok: true, plans: [] });
  const plans = await listMembershipPlans(env.DB, { enabledOnly: true });
  return json({
    ok: true,
    plans: plans.map((plan) => ({
      id: plan.planKey,
      name: plan.name,
      price: plan.priceLabel,
      tag: plan.badge,
      note: plan.description,
      features: plan.features
    }))
  });
}
