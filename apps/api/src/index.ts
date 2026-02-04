export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  NODE_ENV?: string;
  SESSION_SECRET?: string;
  SIGNING_SECRET?: string;
  MINDAR_JOB_SECRET?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_REF?: string;
}

const BUILD = "STAGING-BUILD-2026-02-04-B";

type User = { email: string };

function base64urlEncode(bytes: ArrayBuffer) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64urlEncodeText(text: string) {
  return base64urlEncode(new TextEncoder().encode(text).buffer);
}
function base64urlDecodeToText(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
async function hmacSign(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64urlEncode(sig);
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") || "";

  const allowed = [
    "https://staging.vidcom-admin.pages.dev",
    "https://vidcom-admin.pages.dev",
    "https://staging.vidcom-2-life-v3.pages.dev",
    "https://vidcom-2-life-v3.pages.dev",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];

  const isPagesPreview = /^https:\/\/[a-z0-9]+\.vidcom-admin\.pages\.dev$/i.test(origin);
  const isViewerPreview = /^https:\/\/[a-z0-9]+\.vidcom-2-life-v3\.pages\.dev$/i.test(origin);
  const allowOrigin = allowed.includes(origin) || isPagesPreview || isViewerPreview ? origin : "null";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      request.headers.get("Access-Control-Request-Headers") ||
      "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(request: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
      ...extra,
    },
  });
}

async function readBodyAny(request: Request): Promise<any | null> {
  // Try JSON first
  try {
    const ct = (request.headers.get("Content-Type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      return await request.json();
    }
  } catch {}

  // Fallback: try parse raw text as JSON
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getBearerToken(request: Request) {
  const auth = request.headers.get("Authorization") || request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function issueToken(env: Env, user: User) {
  const secret = env.SIGNING_SECRET || env.SESSION_SECRET || "staging-signing-secret";
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60 * 24 * 7;
  const payloadObj = { email: user.email, iat: now, exp };
  const payload = base64urlEncodeText(JSON.stringify(payloadObj));
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

async function verifyToken(env: Env, token: string): Promise<User | null> {
  const secret = env.SIGNING_SECRET || env.SESSION_SECRET || "staging-signing-secret";
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;

  const expected = await hmacSign(secret, payload);
  if (sig !== expected) return null;

  try {
    const obj = JSON.parse(base64urlDecodeToText(payload)) as { email: string; exp: number };
    const now = Math.floor(Date.now() / 1000);
    if (!obj.email || !obj.exp || obj.exp < now) return null;
    return { email: obj.email };
  } catch {
    return null;
  }
}

async function requireUser(request: Request, env: Env) {
  const token = getBearerToken(request);
  if (!token) return null;
  return await verifyToken(env, token);
}

function uuid() {
  // @ts-ignore
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}
function nowIso() {
  return new Date().toISOString();
}
function genQrId() {
  return uuid().replace(/-/g, "").slice(0, 12);
}

function sanitizeFilename(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "file";
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "file";
}

async function buildUploadToken(env: Env, r2Key: string) {
  const secret = env.SIGNING_SECRET || env.SESSION_SECRET || "staging-signing-secret";
  return await hmacSign(secret, `upload:${r2Key}`);
}

async function verifyUploadToken(env: Env, r2Key: string, token: string | null) {
  if (!token) return false;
  const expected = await buildUploadToken(env, r2Key);
  return token === expected;
}

async function buildAssetToken(env: Env, assetId: string) {
  const secret = env.SIGNING_SECRET || env.SESSION_SECRET || "staging-signing-secret";
  return await hmacSign(secret, `asset:${assetId}`);
}

async function verifyAssetToken(env: Env, assetId: string, token: string | null) {
  if (!token) return false;
  const expected = await buildAssetToken(env, assetId);
  return token === expected;
}

type ExperienceRow = {
  id: string;
  name: string;
  qr_id: string;
  is_active: number;
  created_at: string;
  updated_at: string;
};

function mapExperience(row: ExperienceRow) {
  return {
    id: row.id,
    name: row.name,
    qr_id: row.qr_id,
    is_active: Boolean(row.is_active),
  };
}

function isJobSecretValid(env: Env, request: Request) {
  const secret = env.MINDAR_JOB_SECRET || "";
  const header = request.headers.get("x-job-secret") || "";
  return secret.length > 0 && header === secret;
}

async function dispatchMindarJob(env: Env, pairId: string, imagePublicUrl: string, apiBase: string) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    console.log("MindAR job dispatch skipped: missing GITHUB_TOKEN or GITHUB_REPO");
    return false;
  }
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/mindar-generate.yml/dispatches`;
  const body = {
    ref: env.GITHUB_REF || "main",
    inputs: {
      pairId,
      imagePublicUrl,
      apiBase,
    },
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "vidcom-mindar-dispatch",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.log("MindAR dispatch failed", resp.status, text);
    return false;
  }
  return true;
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const origin = url.origin;

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      if (path === "/api/health") {
        return json(request, {
          ok: true,
          service: "vidcom-api",
          env: env.NODE_ENV || "unknown",
          build: BUILD,
          time: new Date().toISOString(),
        });
      }

      // ---- PUBLIC ASSETS ----
      if (path.startsWith("/public/assets/") && request.method === "GET") {
        const assetId = decodeURIComponent(path.slice("/public/assets/".length));
        if (!assetId) return json(request, { error: "Not Found", build: BUILD }, 404);
        const asset = await env.DB.prepare(
          "SELECT id, r2_key, mime FROM assets WHERE id = ? LIMIT 1"
        ).bind(assetId).first<{ id: string; r2_key: string; mime: string }>();
        if (!asset) return json(request, { error: "Not Found", build: BUILD }, 404);
        const obj = await env.BUCKET.get(asset.r2_key);
        if (!obj) return json(request, { error: "Not Found", build: BUILD }, 404);
        return new Response(obj.body, {
          headers: {
            "Content-Type": asset.mime || "application/octet-stream",
            ...corsHeaders(request),
          },
        });
      }

      // ---- PUBLIC ----
      const publicMatch = path.match(/^\/public\/experience\/([^/]+)$/);
      if (publicMatch && request.method === "GET") {
        const qrId = decodeURIComponent(publicMatch[1]);
        const exp = await env.DB.prepare(
          "SELECT id, name, qr_id, is_active, created_at, updated_at FROM experiences WHERE qr_id = ? LIMIT 1"
        ).bind(qrId).first<ExperienceRow>();

        if (!exp || !exp.is_active) {
          return json(request, { error: "Not Found", build: BUILD }, 404);
        }

        const pair = await env.DB.prepare(
          "SELECT id, image_asset_id, video_asset_id, mind_target_asset_id, mind_target_status, threshold, priority, is_active FROM pairs WHERE experience_id = ? AND is_active = 1 ORDER BY priority DESC, id DESC LIMIT 1"
        ).bind(exp.id).first<{
          id: string;
          image_asset_id: string;
          video_asset_id: string;
          mind_target_asset_id: string | null;
          mind_target_status: string | null;
          threshold: number;
          priority: number;
          is_active: number;
        }>();

        let mindarTargetUrl: string | null = null;
        let videoUrl: string | null = null;
        if (pair?.mind_target_status === "ready" && pair?.mind_target_asset_id) {
          mindarTargetUrl = `${origin}/public/assets/${pair.mind_target_asset_id}`;
        }
        if (pair?.video_asset_id) {
          videoUrl = `${origin}/public/assets/${pair.video_asset_id}`;
        }

        return json(
          request,
          {
            ok: true,
            experience: mapExperience(exp),
            mindarTargetUrl,
            videoUrl,
            mind_target_status: pair?.mind_target_status ?? null,
            build: BUILD,
          },
          200
        );
      }

      // ---- AUTH ----
      if (path === "/auth/login" && request.method === "POST") {
        const body = await readBodyAny(request);
        const email = String(body?.email || "").trim().toLowerCase();
        const password = String(body?.password || "");

        // HARD-CODED VIBE LOGIN (for now)
        if (!(email === "admin@local" && password === "admin123")) {
          return json(request, { error: "Invalid credentials", build: BUILD, seen_email: email }, 401);
        }

        const token = await issueToken(env, { email });
        return json(request, { token, build: BUILD }, 200);
      }

      if (path === "/auth/me" && request.method === "GET") {
        const token = getBearerToken(request);
        if (!token) return json(request, { error: "Unauthorized", build: BUILD }, 401);

        const user = await verifyToken(env, token);
        if (!user) return json(request, { error: "Unauthorized", build: BUILD }, 401);

        return json(request, { ok: true, user, build: BUILD }, 200);
      }

      if (path === "/auth/logout" && request.method === "POST") {
        return json(request, { ok: true, build: BUILD }, 200);
      }

      // Require auth for protected routes
      const isUploadPut = path.startsWith("/uploads/put/");
      const user = await requireUser(request, env);
      const needsAuth =
        url.pathname.startsWith("/experiences") ||
        url.pathname.startsWith("/pairs") ||
        url.pathname.startsWith("/uploads");

      if (needsAuth && !user && !isUploadPut && !isJobSecretValid(env, request)) {
        return json(request, { error: "Unauthorized", build: BUILD }, 401);
      }

      // ---- UPLOADS ----
      if (path === "/uploads/sign" && request.method === "POST") {
        const body = await readBodyAny(request);
        const kind = String(body?.kind || "").trim();
        const mime = String(body?.mime || "application/octet-stream").trim();
        const filename = String(body?.filename || "file").trim();
        const r2Key = `${kind}/${uuid()}-${sanitizeFilename(filename)}`;
        const token = await buildUploadToken(env, r2Key);
        const uploadUrl = `${origin}/uploads/put/${encodeURIComponent(r2Key)}?token=${encodeURIComponent(
          token
        )}&mime=${encodeURIComponent(mime)}`;
        return json(request, { uploadUrl, r2Key, build: BUILD }, 200);
      }

      if (path.startsWith("/uploads/put/") && request.method === "PUT") {
        const r2Key = decodeURIComponent(path.slice("/uploads/put/".length));
        if (!r2Key) return json(request, { error: "Not Found", build: BUILD }, 404);
        const token = url.searchParams.get("token");
        const ok = await verifyUploadToken(env, r2Key, token);
        if (!ok) return json(request, { error: "Unauthorized", build: BUILD }, 401);
        const mime = url.searchParams.get("mime") || "application/octet-stream";
        const data = await request.arrayBuffer();
        await env.BUCKET.put(r2Key, data, {
          httpMetadata: { contentType: mime },
        });
        return json(request, { ok: true, r2Key, build: BUILD }, 200);
      }

      if (path === "/uploads/complete" && request.method === "POST") {
        const body = await readBodyAny(request);
        const kind = String(body?.kind || "").trim();
        const r2Key = String(body?.r2Key || "").trim();
        const mime = String(body?.mime || "application/octet-stream").trim();
        const size = Number(body?.size || 0);
        if (!kind || !r2Key) return json(request, { error: "Invalid upload", build: BUILD }, 400);

        const id = uuid();
        await env.DB.prepare(
          "INSERT INTO assets (id, kind, r2_key, mime, size) VALUES (?, ?, ?, ?, ?)"
        ).bind(id, kind, r2Key, mime, size).run();

        const assetToken = await buildAssetToken(env, id);
        return json(
          request,
          {
            id,
            kind,
            r2_key: r2Key,
            mime,
            size,
            url: `${origin}/assets/${id}?token=${encodeURIComponent(assetToken)}`,
            build: BUILD,
          },
          200
        );
      }

      // ---- ASSETS (admin) ----
      if (path.startsWith("/assets/") && request.method === "GET") {
        const assetId = decodeURIComponent(path.slice("/assets/".length));
        if (!assetId) return json(request, { error: "Not Found", build: BUILD }, 404);
        const assetToken = url.searchParams.get("token");
        const tokenOk = await verifyAssetToken(env, assetId, assetToken);
        if (!tokenOk && !user) {
          return json(request, { error: "Unauthorized", build: BUILD }, 401);
        }
        const asset = await env.DB.prepare(
          "SELECT id, r2_key, mime FROM assets WHERE id = ? LIMIT 1"
        ).bind(assetId).first<{ id: string; r2_key: string; mime: string }>();
        if (!asset) return json(request, { error: "Not Found", build: BUILD }, 404);
        const obj = await env.BUCKET.get(asset.r2_key);
        if (!obj) return json(request, { error: "Not Found", build: BUILD }, 404);
        return new Response(obj.body, {
          headers: {
            "Content-Type": asset.mime || "application/octet-stream",
            ...corsHeaders(request),
          },
        });
      }


      // ---- MINDAR JOBS ----
      if (path === "/jobs/mindar/dispatch" && request.method === "POST") {
        if (!user) {
          return json(request, { error: "Unauthorized", build: BUILD }, 401);
        }
        const body = await readBodyAny(request);
        const pairId = String(body?.pairId || "").trim();
        const imageAssetId = String(body?.image_asset_id || "").trim();
        if (!pairId || !imageAssetId) {
          return json(request, { error: "Missing pairId or image_asset_id", build: BUILD }, 400);
        }
        const imagePublicUrl = `${origin}/public/assets/${imageAssetId}`;
        const t = nowIso();
        await env.DB.prepare(
          "UPDATE pairs SET mind_target_status = ?, mind_target_error = NULL, mind_target_requested_at = ? WHERE id = ?"
        ).bind("pending", t, pairId).run();
        const ok = await dispatchMindarJob(env, pairId, imagePublicUrl, origin);
        if (!ok) {
          await env.DB.prepare(
            "UPDATE pairs SET mind_target_status = ?, mind_target_error = ? WHERE id = ?"
          ).bind("failed", "Dispatch failed", pairId).run();
        }
        return json(request, { ok, build: BUILD }, 200);
      }

      if (path === "/jobs/mindar/complete" && request.method === "POST") {
        if (!isJobSecretValid(env, request)) {
          return json(request, { error: "Unauthorized", build: BUILD }, 401);
        }
        const body = await readBodyAny(request);
        const pairId = String(body?.pairId || "").trim();
        const mindAssetId = String(body?.mindAssetId || "").trim();
        const errorMessage = body?.error ? String(body.error) : "";
        if (!pairId) {
          return json(request, { error: "Missing pairId", build: BUILD }, 400);
        }
        const t = nowIso();
        if (errorMessage || !mindAssetId) {
          await env.DB.prepare(
            "UPDATE pairs SET mind_target_status = ?, mind_target_error = ?, mind_target_completed_at = ? WHERE id = ?"
          ).bind("failed", errorMessage || "MindAR generation failed", t, pairId).run();
          return json(request, { ok: false, error: errorMessage || "MindAR generation failed", build: BUILD }, 200);
        }
        await env.DB.prepare(
          "UPDATE pairs SET mind_target_asset_id = ?, mind_target_status = ?, mind_target_error = NULL, mind_target_completed_at = ? WHERE id = ?"
        ).bind(mindAssetId, "ready", t, pairId).run();
        return json(request, { ok: true, build: BUILD }, 200);
      }

      // ---- EXPERIENCES ----
      if (path === "/experiences" && request.method === "GET") {
        const res = await env.DB.prepare(
          "SELECT id, name, qr_id, is_active, created_at, updated_at FROM experiences ORDER BY created_at DESC"
        ).all<ExperienceRow>();
        return json(request, { experiences: (res.results || []).map(mapExperience), build: BUILD }, 200);
      }

      if (path === "/experiences" && request.method === "POST") {
        const body = await readBodyAny(request);
        const name = String(body?.name || "").trim();
        if (!name) return json(request, { error: "Name is required", build: BUILD }, 400);

        const id = uuid();
        const qr_id = genQrId();
        const t = nowIso();

        await env.DB.prepare(
          "INSERT INTO experiences (id, name, qr_id, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
        ).bind(id, name, qr_id, t, t).run();

        return json(request, { id, name, qr_id, is_active: true, build: BUILD }, 200);
      }

      const expMatch = path.match(/^\/experiences\/([^/]+)$/);
      if (expMatch && request.method === "GET") {
        const id = decodeURIComponent(expMatch[1]);
        const exp = await env.DB.prepare(
          "SELECT id, name, qr_id, is_active, created_at, updated_at FROM experiences WHERE id = ? LIMIT 1"
        ).bind(id).first<ExperienceRow>();
        if (!exp) return json(request, { error: "Not Found", build: BUILD }, 404);
        return json(request, mapExperience(exp), 200);
      }

      if (expMatch && request.method === "PUT") {
        const id = decodeURIComponent(expMatch[1]);
        const body = await readBodyAny(request);
        const name = body?.name !== undefined ? String(body?.name || "").trim() : null;
        const isActive = body?.is_active !== undefined ? Boolean(body?.is_active) : null;
        const qrId = body?.qr_id !== undefined ? String(body?.qr_id || "").trim() : null;

        const existing = await env.DB.prepare(
          "SELECT id, name, qr_id, is_active, created_at, updated_at FROM experiences WHERE id = ? LIMIT 1"
        ).bind(id).first<ExperienceRow>();
        if (!existing) return json(request, { error: "Not Found", build: BUILD }, 404);

        const nextName = name ?? existing.name;
        const nextQr = qrId ?? existing.qr_id;
        const nextActive = isActive === null ? existing.is_active : isActive ? 1 : 0;
        const t = nowIso();

        await env.DB.prepare(
          "UPDATE experiences SET name = ?, qr_id = ?, is_active = ?, updated_at = ? WHERE id = ?"
        ).bind(nextName, nextQr, nextActive, t, id).run();

        return json(request, { id, name: nextName, qr_id: nextQr, is_active: Boolean(nextActive), build: BUILD }, 200);
      }

      if (expMatch && request.method === "DELETE") {
        const id = decodeURIComponent(expMatch[1]);
        await env.DB.prepare("DELETE FROM pairs WHERE experience_id = ?").bind(id).run();
        const res = await env.DB.prepare("DELETE FROM experiences WHERE id = ?").bind(id).run();
        if (!res.success) return json(request, { error: "Not Found", build: BUILD }, 404);
        return json(request, { ok: true, build: BUILD }, 200);
      }

      const expPairsMatch = path.match(/^\/experiences\/([^/]+)\/pairs$/);
      if (expPairsMatch && request.method === "GET") {
        const id = decodeURIComponent(expPairsMatch[1]);
        const res = await env.DB.prepare(
          `SELECT p.id,
                  p.experience_id,
                  p.image_asset_id,
                  p.video_asset_id,
                  p.mind_target_asset_id,
                  p.mind_target_status,
                  p.mind_target_error,
                  p.mind_target_requested_at,
                  p.mind_target_completed_at,
                  p.image_fingerprint,
                  p.threshold,
                  p.priority,
                  p.is_active,
                  ai.r2_key AS image_r2_key,
                  ai.mime AS image_mime,
                  ai.size AS image_size,
                  am.r2_key AS mind_r2_key,
                  am.mime AS mind_mime,
                  am.size AS mind_size,
                  av.r2_key AS video_r2_key,
                  av.mime AS video_mime,
                  av.size AS video_size
           FROM pairs p
           LEFT JOIN assets ai ON ai.id = p.image_asset_id
           LEFT JOIN assets am ON am.id = p.mind_target_asset_id
           LEFT JOIN assets av ON av.id = p.video_asset_id
           WHERE p.experience_id = ?
           ORDER BY p.priority DESC, p.id DESC`
        ).bind(id).all<any>();

        const pairs = await Promise.all((res.results || []).map(async (row: any) => {
          let fingerprint = row.image_fingerprint;
          try {
            fingerprint = row.image_fingerprint ? JSON.parse(row.image_fingerprint) : row.image_fingerprint;
          } catch {}
          const imageToken = row.image_asset_id ? await buildAssetToken(env, row.image_asset_id) : null;
          const videoToken = row.video_asset_id ? await buildAssetToken(env, row.video_asset_id) : null;
          return {
            id: row.id,
            experience_id: row.experience_id,
            image_asset_id: row.image_asset_id,
            video_asset_id: row.video_asset_id,
            mind_target_asset_id: row.mind_target_asset_id,
            mind_target_status: row.mind_target_status,
            mind_target_error: row.mind_target_error,
            mind_target_requested_at: row.mind_target_requested_at,
            mind_target_completed_at: row.mind_target_completed_at,
            image_fingerprint: fingerprint,
            threshold: row.threshold,
            priority: row.priority,
            is_active: Boolean(row.is_active),
            image_r2_key: row.image_r2_key,
            mind_r2_key: row.mind_r2_key,
            video_r2_key: row.video_r2_key,
            image_mime: row.image_mime,
            mind_mime: row.mind_mime,
            video_mime: row.video_mime,
            image_size: row.image_size,
            mind_size: row.mind_size,
            video_size: row.video_size,
            image_url: row.image_asset_id
              ? `${origin}/assets/${row.image_asset_id}?token=${encodeURIComponent(imageToken)}`
              : null,
            mind_target_url: row.mind_target_asset_id
              ? `${origin}/assets/${row.mind_target_asset_id}?token=${encodeURIComponent(
                  await buildAssetToken(env, row.mind_target_asset_id)
                )}`
              : null,
            video_url: row.video_asset_id
              ? `${origin}/assets/${row.video_asset_id}?token=${encodeURIComponent(videoToken)}`
              : null,
          };
        }));

        return json(request, { pairs, build: BUILD }, 200);
      }

      if (expPairsMatch && request.method === "POST") {
        const expId = decodeURIComponent(expPairsMatch[1]);
        const body = await readBodyAny(request);
        const imageAssetId = String(body?.image_asset_id || "").trim();
        const videoAssetId = String(body?.video_asset_id || "").trim();
        const fingerprint = body?.image_fingerprint ?? null;
        const threshold = Number(body?.match_threshold ?? body?.threshold ?? 0.8);
        const priority = Number(body?.priority ?? 0);

        if (!imageAssetId || !videoAssetId) {
          return json(request, { error: "Missing assets", build: BUILD }, 400);
        }

        const id = uuid();
        await env.DB.prepare(
          "INSERT INTO pairs (id, experience_id, image_asset_id, video_asset_id, mind_target_status, mind_target_requested_at, image_fingerprint, threshold, priority, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)"
        ).bind(
          id,
          expId,
          imageAssetId,
          videoAssetId,
          "pending",
          nowIso(),
          fingerprint ? JSON.stringify(fingerprint) : null,
          threshold,
          priority
        ).run();

        const imagePublicUrl = `${origin}/public/assets/${imageAssetId}`;
        const ok = await dispatchMindarJob(env, id, imagePublicUrl, origin);
        if (!ok) {
          await env.DB.prepare(
            "UPDATE pairs SET mind_target_status = ?, mind_target_error = ? WHERE id = ?"
          ).bind("failed", "Dispatch failed", id).run();
        }
        return json(request, { id, build: BUILD }, 200);
      }

      const pairMatch = path.match(/^\/pairs\/([^/]+)$/);
      if (pairMatch && request.method === "PUT") {
        const pairId = decodeURIComponent(pairMatch[1]);
        const body = await readBodyAny(request);
        const experienceId = body?.experience_id ? String(body.experience_id).trim() : null;
        const imageAssetId = body?.image_asset_id ? String(body.image_asset_id).trim() : null;
        const videoAssetId = body?.video_asset_id ? String(body.video_asset_id).trim() : null;
        const fingerprint = body?.image_fingerprint ?? null;
        const threshold = body?.threshold !== undefined ? Number(body.threshold) : null;
        const priority = body?.priority !== undefined ? Number(body.priority) : null;
        const isActive = body?.is_active !== undefined ? Boolean(body.is_active) : null;

        const existing = await env.DB.prepare(
          "SELECT id, experience_id, image_asset_id, video_asset_id, image_fingerprint, mind_target_asset_id, mind_target_status, mind_target_requested_at, threshold, priority, is_active FROM pairs WHERE id = ? LIMIT 1"
        ).bind(pairId).first<any>();
        if (!existing) return json(request, { error: "Not Found", build: BUILD }, 404);

        const nextExperienceId = experienceId ?? existing.experience_id;
        const nextImageAssetId = imageAssetId ?? existing.image_asset_id;
        const nextVideoAssetId = videoAssetId ?? existing.video_asset_id;
        const nextFingerprint =
          fingerprint !== null && fingerprint !== undefined
            ? JSON.stringify(fingerprint)
            : existing.image_fingerprint;
        const nextThreshold = threshold ?? existing.threshold;
        const nextPriority = priority ?? existing.priority;
        const nextActive = isActive === null ? existing.is_active : isActive ? 1 : 0;
        const imageChanged = imageAssetId && imageAssetId !== existing.image_asset_id;
        const t = nowIso();
        const nextMindStatus = imageChanged ? "pending" : existing.mind_target_status;
        const nextMindAssetId = imageChanged ? null : existing.mind_target_asset_id;
        const nextMindRequestedAt = imageChanged ? t : existing.mind_target_requested_at;

        await env.DB.prepare(
          "UPDATE pairs SET experience_id = ?, image_asset_id = ?, video_asset_id = ?, image_fingerprint = ?, mind_target_asset_id = ?, mind_target_status = ?, mind_target_error = NULL, mind_target_requested_at = ?, threshold = ?, priority = ?, is_active = ? WHERE id = ?"
        ).bind(
          nextExperienceId,
          nextImageAssetId,
          nextVideoAssetId,
          nextFingerprint,
          nextMindAssetId,
          nextMindStatus,
          nextMindRequestedAt,
          nextThreshold,
          nextPriority,
          nextActive,
          pairId
        ).run();

        if (imageChanged) {
          const imagePublicUrl = `${origin}/public/assets/${imageAssetId}`;
          const ok = await dispatchMindarJob(env, pairId, imagePublicUrl, origin);
          if (!ok) {
            await env.DB.prepare(
              "UPDATE pairs SET mind_target_status = ?, mind_target_error = ? WHERE id = ?"
            ).bind("failed", "Dispatch failed", pairId).run();
          }
        }

        return json(request, { ok: true, build: BUILD }, 200);
      }

      if (pairMatch && request.method === "DELETE") {
        const pairId = decodeURIComponent(pairMatch[1]);
        await env.DB.prepare("DELETE FROM pairs WHERE id = ?").bind(pairId).run();
        return json(request, { ok: true, build: BUILD }, 200);
      }

      return json(request, { error: "Not Found", build: BUILD, path, method: request.method }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal Server Error";
      return json(request, { error: message, build: BUILD }, 500);
    }
  },
};
