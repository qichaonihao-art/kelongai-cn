import { json } from '../_tikhub.js';
import { defaultSiteContent, getSiteContent } from '../_site_content.js';

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return json({ ok: true, content: defaultSiteContent() });
  const content = await getSiteContent(env.DB);
  return json({ ok: true, content });
}
