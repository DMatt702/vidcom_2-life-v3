export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  NODE_ENV?: string;
  SESSION_SECRET?: string;
  SIGNING_SECRET?: string;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const encoder = new TextEncoder();

function jsonResponse(data: JsonValue, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function parseAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const parts = cookie.split(";").map((part) => part.trim());
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "session_token") return value;
  }
  return null;
}

function base64UrlEncode(input: ArrayBuffer): string {
  const bytes = new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer.buffer);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${password}`);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function signPayload(payload: Record<string, JsonValue>, secret: string): Promise<string> {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `${btoa(body)}.${base64UrlEncode(signature)}`;
}

async function verifyPayload(token: string, secret: string): Promise<Record<string, JsonValue> | null> {
  const [bodyB64, sig] = token.split(".");
  if (!bodyB64 || !sig) return null;
  const body = atob(bodyB64);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
    encoder.encode(body)
  );
  if (!isValid) return null;
  return JSON.parse(body) as Record<string, JsonValue>;
}

async function requireAuth(request: Request, env: Env) {
  const token = parseAuthToken(request);
  if (!token) return null;
  const session = await env.DB.prepare(
    "SELECT token, user_id, expires_at FROM sessions WHERE token = ?"
  ).bind(token).first<{ token: string; user_id: string; expires_at: string }>();
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  const user = await env.DB.prepare(
    "SELECT id, email, role, is_active FROM users WHERE id = ?"
  ).bind(session.user_id).first<{ id: string; email: string; role: string; is_active: number }>();
  if (!user || !user.is_active) return null;
  return user;
}

async function parseJsonBody(request: Request): Promise<Record<string, JsonValue> | null> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return null;
  }
  try {
    return (await request.json()) as Record<string, JsonValue>;
  } catch {
    return null;
  }
}

function assertString(value: JsonValue | undefined, name: string): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function assertNumber(value: JsonValue | undefined, name: string): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildQrId(): string {
  const token = randomToken(8);
  return token.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
}

function buildR2Key(kind: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `uploads/${kind}/${crypto.randomUUID()}-${safeName}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (request.method === "POST" && path === "/dev/seed-admin") {
      if (env.NODE_ENV !== "development") {
        return errorResponse("Not available", 404);
      }
      const body = (await parseJsonBody(request)) ?? {};
      const email = assertString(body.email, "email") ?? "admin@local";
      const password = assertString(body.password, "password") ?? "admin123";
      const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
        .bind(email)
        .first<{ id: string }>();
      if (existing) {
        return jsonResponse({ ok: true, email, password, existed: true });
      }
      const salt = randomToken(8);
      const hash = await hashPassword(password, salt);
      const userId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, password_salt, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
      )
        .bind(userId, email, hash, salt, "admin", nowIso())
        .run();
      return jsonResponse({ ok: true, email, password, created: true });
    }

    if (request.method === "POST" && path === "/auth/login") {
      const body = await parseJsonBody(request);
      if (!body) return errorResponse("Expected JSON body");
      const email = assertString(body.email, "email");
      const password = assertString(body.password, "password");
      if (!email || !password) return errorResponse("Missing email or password");
      const user = await env.DB.prepare(
        "SELECT id, email, password_hash, password_salt, is_active FROM users WHERE email = ?"
      ).bind(email).first<{
        id: string;
        email: string;
        password_hash: string;
        password_salt: string;
        is_active: number;
      }>();
      if (!user || !user.is_active) return errorResponse("Invalid credentials", 401);
      const hash = await hashPassword(password, user.password_salt);
      if (hash !== user.password_hash) return errorResponse("Invalid credentials", 401);
      const token = randomToken(32);
      const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      await env.DB.prepare(
        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
      )
        .bind(token, user.id, nowIso(), expires.toISOString())
        .run();
      const headers = new Headers();
      headers.set(
        "set-cookie",
        `session_token=${token}; Path=/; HttpOnly; SameSite=Lax`
      );
      return jsonResponse({ token }, 200, headers);
    }

    if (request.method === "POST" && path === "/auth/logout") {
      const token = parseAuthToken(request);
      if (token) {
        await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
      }
      const headers = new Headers();
      headers.set(
        "set-cookie",
        "session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
      );
      return jsonResponse({ ok: true }, 200, headers);
    }

    if (request.method === "GET" && path === "/auth/me") {
      const user = await requireAuth(request, env);
      if (!user) return errorResponse("Unauthorized", 401);
      return jsonResponse({ user });
    }

    if (request.method === "POST" && path === "/uploads/sign") {
      const user = await requireAuth(request, env);
      if (!user) return errorResponse("Unauthorized", 401);
      const body = await parseJsonBody(request);
      if (!body) return errorResponse("Expected JSON body");
      const kind = assertString(body.kind, "kind");
      const mime = assertString(body.mime, "mime");
      const filename = assertString(body.filename, "filename");
      const size = assertNumber(body.size, "size");
      if (!kind || !mime || !filename || size === null) {
        return errorResponse("Missing upload fields");
      }
      if (kind !== "image" && kind !== "video") return errorResponse("Invalid kind");
      const r2Key = buildR2Key(kind, filename);
      const secret = env.SIGNING_SECRET ?? "dev-signing-secret";
      const payload = {
        r2Key,
        kind,
        mime,
        size,
        exp: Date.now() + 1000 * 60 * 5
      };
      const token = await signPayload(payload, secret);
      const uploadUrl = `${url.origin}/uploads/put/${encodeURIComponent(r2Key)}?token=${encodeURIComponent(
        token
      )}`;
      return jsonResponse({ uploadUrl, r2Key });
    }

    if (request.method === "PUT" && path.startsWith("/uploads/put/")) {
      const token = url.searchParams.get("token");
      if (!token) return errorResponse("Missing token", 401);
      const secret = env.SIGNING_SECRET ?? "dev-signing-secret";
      const payload = await verifyPayload(token, secret);
      if (!payload) return errorResponse("Invalid token", 401);
      const r2Key = decodeURIComponent(path.replace("/uploads/put/", ""));
      if (payload.r2Key !== r2Key) return errorResponse("Token mismatch", 403);
      const exp = typeof payload.exp === "number" ? payload.exp : 0;
      if (Date.now() > exp) return errorResponse("Token expired", 403);
      const body = await request.arrayBuffer();
      const contentType = request.headers.get("content-type") ?? "application/octet-stream";
      await env.BUCKET.put(r2Key, body, {
        httpMetadata: { contentType }
      });
      return jsonResponse({ ok: true, r2Key, size: body.byteLength });
    }

    if (request.method === "POST" && path === "/uploads/complete") {
      const user = await requireAuth(request, env);
      if (!user) return errorResponse("Unauthorized", 401);
      const body = await parseJsonBody(request);
      if (!body) return errorResponse("Expected JSON body");
      const kind = assertString(body.kind, "kind");
      const r2Key = assertString(body.r2Key, "r2Key");
      const mime = assertString(body.mime, "mime");
      const filename = assertString(body.filename, "filename");
      const size = assertNumber(body.size, "size");
      if (!kind || !r2Key || !mime || !filename || size === null) {
        return errorResponse("Missing asset fields");
      }
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO assets (id, kind, r2_key, mime, size) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(id, kind, r2Key, mime, size)
        .run();
      return jsonResponse({ id, kind, r2_key: r2Key, mime, size });
    }

    if (request.method === "POST" && path === "/experiences") {
      const user = await requireAuth(request, env);
      if (!user) return errorResponse("Unauthorized", 401);
      const body = await parseJsonBody(request);
      if (!body) return errorResponse("Expected JSON body");
      const name = assertString(body.name, "name");
      if (!name) return errorResponse("Missing name");
      const id = crypto.randomUUID();
      let qrId = buildQrId();
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await env.DB.prepare("SELECT id FROM experiences WHERE qr_id = ?")
          .bind(qrId)
          .first<{ id: string }>();
        if (!existing) break;
        qrId = buildQrId();
      }
      await env.DB.prepare(
        "INSERT INTO experiences (id, name, qr_id, is_active) VALUES (?, ?, ?, 1)"
      )
        .bind(id, name, qrId)
        .run();
      return jsonResponse({ id, name, qr_id: qrId, is_active: true });
    }

    if (request.method === "GET" && path === "/experiences") {
      const user = await requireAuth(request, env);
      if (!user) return errorResponse("Unauthorized", 401);
      const results = await env.DB.prepare(
        "SELECT id, name, qr_id, is_active FROM experiences ORDER BY rowid DESC"
      ).all<{ id: string; name: string; qr_id: string; is_active: number }>();
      return jsonResponse({
        experiences: results.results.map((exp) => ({
          ...exp,
          is_active: Boolean(exp.is_active)
        }))
      });
    }

    if (path.startsWith("/experiences/") && !path.endsWith("/pairs")) {
      const user = await requireAuth(request, env);
      if (!user) return errorResponse("Unauthorized", 401);
      const id = path.split("/")[2];
      if (!id) return errorResponse("Missing id");
      if (request.method === "GET") {
        const experience = await env.DB.prepare(
          "SELECT id, name, qr_id, is_active FROM experiences WHERE id = ?"
        )
          .bind(id)
          .first<{ id: string; name: string; qr_id: string; is_active: number }>();
        if (!experience) return errorResponse("Not found", 404);
        return jsonResponse({
          ...experience,
          is_active: Boolean(experience.is_active)
        });
      }
      if (request.method === "PUT") {
        const body = await parseJsonBody(request);
        if (!body) return errorResponse("Expected JSON body");
        const name = assertString(body.name, "name");
        const isActiveValue = body.is_active;
        const isActive =
          typeof isActiveValue === "boolean" ? (isActiveValue ? 1 : 0) : null;
        if (!name && isActive === null) return errorResponse("No updates provided");
        if (name) {
          await env.DB.prepare("UPDATE experiences SET name = ? WHERE id = ?")
            .bind(name, id)
            .run();
        }
        if (isActive !== null) {
          await env.DB.prepare("UPDATE experiences SET is_active = ? WHERE id = ?")
            .bind(isActive, id)
            .run();
        }
        const updated = await env.DB.prepare(
          "SELECT id, name, qr_id, is_active FROM experiences WHERE id = ?"
        )
          .bind(id)
          .first<{ id: string; name: string; qr_id: string; is_active: number }>();
        if (!updated) return errorResponse("Not found", 404);
        return jsonResponse({
          ...updated,
          is_active: Boolean(updated.is_active)
        });
      }
    }

    if (path.endsWith("/pairs") && request.method === "POST") {
      const user = await requireAuth(request, env);
      if (!user) return errorResponse("Unauthorized", 401);
      const experienceId = path.split("/")[2];
      if (!experienceId) return errorResponse("Missing experience id");
      const body = await parseJsonBody(request);
      if (!body) return errorResponse("Expected JSON body");
      const imageAssetId = assertString(body.image_asset_id, "image_asset_id");
      const videoAssetId = assertString(body.video_asset_id, "video_asset_id");
      const fingerprint = body.image_fingerprint;
      if (!imageAssetId || !videoAssetId || typeof fingerprint !== "object") {
        return errorResponse("Missing or invalid pair fields");
      }
      const threshold = assertNumber(body.match_threshold, "match_threshold") ?? 0.8;
      const priority = assertNumber(body.priority, "priority") ?? 0;
      const pairId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO pairs (id, experience_id, image_asset_id, video_asset_id, image_fingerprint, threshold, priority, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
      )
        .bind(
          pairId,
          experienceId,
          imageAssetId,
          videoAssetId,
          JSON.stringify(fingerprint),
          threshold,
          priority
        )
        .run();
      return jsonResponse({
        id: pairId,
        experience_id: experienceId,
        image_asset_id: imageAssetId,
        video_asset_id: videoAssetId,
        image_fingerprint: fingerprint,
        threshold,
        priority,
        is_active: true
      });
    }

    if (path.startsWith("/pairs/")) {
      const user = await requireAuth(request, env);
      if (!user) return errorResponse("Unauthorized", 401);
      const pairId = path.split("/")[2];
      if (!pairId) return errorResponse("Missing pair id");
      if (request.method === "PUT") {
        const body = await parseJsonBody(request);
        if (!body) return errorResponse("Expected JSON body");
        const updates: string[] = [];
        const binds: JsonValue[] = [];
        if (typeof body.is_active === "boolean") {
          updates.push("is_active = ?");
          binds.push(body.is_active ? 1 : 0);
        }
        if (typeof body.threshold === "number") {
          updates.push("threshold = ?");
          binds.push(body.threshold);
        }
        if (typeof body.priority === "number") {
          updates.push("priority = ?");
          binds.push(body.priority);
        }
        if (!updates.length) return errorResponse("No updates provided");
        binds.push(pairId);
        await env.DB.prepare(`UPDATE pairs SET ${updates.join(", ")} WHERE id = ?`)
          .bind(...binds)
          .run();
        const updated = await env.DB.prepare(
          "SELECT id, experience_id, image_asset_id, video_asset_id, image_fingerprint, threshold, priority, is_active FROM pairs WHERE id = ?"
        )
          .bind(pairId)
          .first<{
            id: string;
            experience_id: string;
            image_asset_id: string;
            video_asset_id: string;
            image_fingerprint: string;
            threshold: number;
            priority: number;
            is_active: number;
          }>();
        if (!updated) return errorResponse("Not found", 404);
        return jsonResponse({
          ...updated,
          image_fingerprint: JSON.parse(updated.image_fingerprint),
          is_active: Boolean(updated.is_active)
        });
      }
      if (request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM pairs WHERE id = ?").bind(pairId).run();
        return jsonResponse({ ok: true });
      }
    }

    if (request.method === "GET" && path.startsWith("/public/experience/")) {
      const qrId = path.split("/")[3];
      if (!qrId) return errorResponse("Missing qr id");
      const experience = await env.DB.prepare(
        "SELECT id, name, qr_id, is_active FROM experiences WHERE qr_id = ?"
      )
        .bind(qrId)
        .first<{ id: string; name: string; qr_id: string; is_active: number }>();
      if (!experience || !experience.is_active) return errorResponse("Not found", 404);
      const pairs = await env.DB.prepare(
        "SELECT pairs.id, pairs.image_asset_id, pairs.video_asset_id, pairs.image_fingerprint, pairs.threshold, pairs.priority, assets.r2_key as video_r2_key, assets.mime as video_mime FROM pairs JOIN assets ON assets.id = pairs.video_asset_id WHERE pairs.experience_id = ? AND pairs.is_active = 1"
      )
        .bind(experience.id)
        .all<{
          id: string;
          image_asset_id: string;
          video_asset_id: string;
          image_fingerprint: string;
          threshold: number;
          priority: number;
          video_r2_key: string;
          video_mime: string;
        }>();
      const secret = env.SIGNING_SECRET ?? "dev-signing-secret";
      const signedPairs = await Promise.all(
        pairs.results.map(async (pair) => {
          const token = await signPayload(
            {
              r2Key: pair.video_r2_key,
              exp: Date.now() + 1000 * 60 * 5
            },
            secret
          );
          const videoUrl = `${url.origin}/public/video/${encodeURIComponent(
            pair.video_r2_key
          )}?token=${encodeURIComponent(token)}`;
          return {
            id: pair.id,
            image_asset_id: pair.image_asset_id,
            video_asset_id: pair.video_asset_id,
            image_fingerprint: JSON.parse(pair.image_fingerprint),
            threshold: pair.threshold,
            priority: pair.priority,
            video_url: videoUrl,
            video_mime: pair.video_mime
          };
        })
      );
      return jsonResponse({
        experience: {
          id: experience.id,
          name: experience.name,
          qr_id: experience.qr_id
        },
        pairs: signedPairs
      });
    }

    if (request.method === "GET" && path.startsWith("/public/video/")) {
      const token = url.searchParams.get("token");
      if (!token) return errorResponse("Missing token", 401);
      const secret = env.SIGNING_SECRET ?? "dev-signing-secret";
      const payload = await verifyPayload(token, secret);
      if (!payload) return errorResponse("Invalid token", 401);
      const exp = typeof payload.exp === "number" ? payload.exp : 0;
      if (Date.now() > exp) return errorResponse("Token expired", 403);
      const r2Key = decodeURIComponent(path.replace("/public/video/", ""));
      if (payload.r2Key !== r2Key) return errorResponse("Token mismatch", 403);
      const obj = await env.BUCKET.get(r2Key);
      if (!obj) return errorResponse("Not found", 404);
      const headers = new Headers();
      if (obj.httpMetadata?.contentType) {
        headers.set("content-type", obj.httpMetadata.contentType);
      }
      return new Response(obj.body, { status: 200, headers });
    }

    return errorResponse("Not found", 404);
  }
};
