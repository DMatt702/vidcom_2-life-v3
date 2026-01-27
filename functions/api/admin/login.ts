import { Env, json } from "../_util";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { password } = await request.json();
  if (password !== env.ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);

  const payload = btoa(JSON.stringify({ role: "admin", iat: Date.now() }));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = btoa(
    String.fromCharCode(
      ...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)))
    )
  );
  return json({ token: `${payload}.${sig}` });
};
