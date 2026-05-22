export async function ensureMembershipPlans(db) {
  return;
}

export async function listMembershipPlans(db, { enabledOnly = false } = {}) {
  return [];
}

export async function getMembershipPlan(db, planKey) {
  return null;
}

export async function upsertMembershipPlan(db, input) {
  return null;
}

export function getDefaultPlanLimit(plan) {
  if (plan === 'monthly' || plan === 'pro') return 100;
  if (plan === 'yearly') return 300;
  if (plan === 'lifetime' || plan === 'admin') return 1000;
  return 999999;
}

export function getDefaultMaxVideoMinutes(plan) {
  if (plan === 'yearly') return 15;
  if (plan === 'lifetime' || plan === 'admin') return 20;
  return 60;
}
