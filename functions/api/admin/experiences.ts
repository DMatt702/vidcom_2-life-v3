import { Env, json, uuid, now, requireAdmin } from "../_util";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await requireAdmin(request, env))) return json({ error: "Unauthorized" }, 401);
  const { campaignId, targetId, videoUrl } = await request.json();
  const id = uuid();

  await env.DB.prepare(
    "INSERT INTO experiences VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, campaignId, targetId, videoUrl, "active", now()).run();

  return json({ id });
};
