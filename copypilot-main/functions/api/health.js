import { json } from './_tikhub.js';

export async function onRequestGet(context) {
  return json({
    ok: true,
    apiConfigured: Boolean(context.env.TIKHUB_API_KEY),
    transcribeConfigured: Boolean(context.env.SILICONFLOW_API_KEY)
  });
}
