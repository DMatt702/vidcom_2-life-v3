import { Env, json, uuid, now, requireAdmin } from "../_util";

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (!(await requireAdmin(request, env))) return json({ error: "Unauthorized" }, 401);

  if (request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM campaigns").all();
    return json(results);
  }

  if (request.method === "POST") {
    const { name } = await request.json();
    const id = uuid();
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    await env.DB.prepare(
      "INSERT INTO campaigns VALUES (?, ?, ?, ?)"
    ).bind(id, name, slug, now()).run();
    return json({ id, name, slug });
  }
};
