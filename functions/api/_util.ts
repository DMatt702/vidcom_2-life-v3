export interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  ADMIN_PASSWORD: string;
  JWT_SECRET: string;
  R2_PUBLIC_BASE?: string;
}

export const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });

export const uuid = () =>
  crypto.randomUUID();

export const now = () => new Date().toISOString();

export async function requireAdmin(req: Request, env: Env) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  const token = h.slice(7);
  const enc = new TextEncoder();
  const [p, sig] = token.split(".");
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(env.JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(atob(sig), c => c.charCodeAt(0)),
    enc.encode(p)
  );
  return ok ? JSON.parse(atob(p)) : null;
}
