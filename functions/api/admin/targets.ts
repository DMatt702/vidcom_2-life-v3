import { Env, json, uuid, now, requireAdmin } from "../_util";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await requireAdmin(request, env))) return json({ error: "Unauthorized" }, 401);

  const form = await request.formData();
  const id = uuid();
  const campaignId = form.get("campaignId") as string;
  const name = form.get("name") as string;
  const image = form.get("image") as File;
  const mind = form.get("mind") as File;

  const imageKey = `targets/${id}/${image.name}`;
  const mindKey = `targets/${id}/${mind.name}`;

  await env.ASSETS.put(imageKey, image.stream());
  await env.ASSETS.put(mindKey, mind.stream());

  await env.DB.prepare(
    "INSERT INTO targets VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, campaignId, name, imageKey, mindKey, now()).run();

  return json({ id });
};
