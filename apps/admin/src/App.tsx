import { useEffect, useMemo, useState } from "react";
import { generateImageFingerprint, type ImageFingerprint } from "@vidcom/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

type Experience = {
  id: string;
  name: string;
  qr_id: string;
  is_active: boolean;
};

type Pair = {
  id: string;
  image_asset_id: string;
  video_asset_id: string;
  image_fingerprint: ImageFingerprint;
  threshold: number;
  priority: number;
  is_active: boolean;
  image_r2_key?: string;
  video_r2_key?: string;
  image_mime?: string;
  video_mime?: string;
  image_size?: number;
  video_size?: number;
};

type Toast = {
  id: string;
  tone: "error" | "success" | "info";
  message: string;
};

function buildToast(tone: Toast["tone"], message: string): Toast {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return { id, tone, message };
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("vidcom_admin_token") ?? "");
  const [authChecked, setAuthChecked] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [isLoadingExperiences, setIsLoadingExperiences] = useState(false);
  const [newExperienceName, setNewExperienceName] = useState("");
  const [selectedExperienceId, setSelectedExperienceId] = useState<string | null>(null);
  const [experienceDetail, setExperienceDetail] = useState<Experience | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [isLoadingPairs, setIsLoadingPairs] = useState(false);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [matchThreshold, setMatchThreshold] = useState("0.8");
  const [priority, setPriority] = useState("0");
  const [isUploading, setIsUploading] = useState(false);

  const [publicPreview, setPublicPreview] = useState<string>("");
  const [isVerifyingPublic, setIsVerifyingPublic] = useState(false);

  const isAuthed = Boolean(token);
  const selectedExperience = useMemo(
    () => experiences.find((exp) => exp.id === selectedExperienceId) ?? experienceDetail,
    [experiences, experienceDetail, selectedExperienceId]
  );

  function pushToast(tone: Toast["tone"], message: string) {
    const toast = buildToast(tone, message);
    setToasts((prev) => [...prev, toast]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== toast.id));
    }, 4500);
  }

  function clearToast(id: string) {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }

  async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("accept", "application/json");
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T);
    if (!response.ok) {
      const message = (data as { error?: string }).error ?? `Request failed (${response.status})`;
      throw new Error(message);
    }
    return data as T;
  }

  useEffect(() => {
    if (!token) {
      setUserEmail(null);
      setAuthChecked(true);
      return;
    }
    (async () => {
      try {
        const data = await apiRequest<{ user: { email: string } }>("/auth/me");
        setUserEmail(data.user.email);
      } catch (error) {
        setToken("");
        localStorage.removeItem("vidcom_admin_token");
        setUserEmail(null);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, [token]);

  useEffect(() => {
    if (!isAuthed) return;
    loadExperiences();
  }, [isAuthed]);

  useEffect(() => {
    if (!selectedExperienceId) {
      setExperienceDetail(null);
      setPairs([]);
      return;
    }
    loadExperienceDetail(selectedExperienceId);
    loadPairs(selectedExperienceId);
  }, [selectedExperienceId]);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setIsLoggingIn(true);
    try {
      const response = await apiRequest<{ token: string }>("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword
        })
      });
      setToken(response.token);
      localStorage.setItem("vidcom_admin_token", response.token);
      pushToast("success", "Logged in.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Login failed.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleLogout() {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } catch {
      // ignore logout errors
    }
    setToken("");
    localStorage.removeItem("vidcom_admin_token");
    setUserEmail(null);
    setSelectedExperienceId(null);
    setExperiences([]);
    setPairs([]);
    pushToast("info", "Logged out.");
  }

  async function loadExperiences() {
    setIsLoadingExperiences(true);
    try {
      const data = await apiRequest<{ experiences: Experience[] }>("/experiences");
      setExperiences(data.experiences);
      if (data.experiences.length && !selectedExperienceId) {
        setSelectedExperienceId(data.experiences[0].id);
      }
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to load experiences.");
    } finally {
      setIsLoadingExperiences(false);
    }
  }

  async function loadExperienceDetail(id: string) {
    try {
      const data = await apiRequest<Experience>(`/experiences/${id}`);
      setExperienceDetail(data);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to load experience.");
    }
  }

  async function loadPairs(id: string) {
    setIsLoadingPairs(true);
    try {
      const data = await apiRequest<{ pairs: Pair[] }>(`/experiences/${id}/pairs`);
      setPairs(data.pairs);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to load pairs.");
    } finally {
      setIsLoadingPairs(false);
    }
  }

  async function handleCreateExperience(event: React.FormEvent) {
    event.preventDefault();
    if (!newExperienceName.trim()) {
      pushToast("error", "Experience name is required.");
      return;
    }
    try {
      const data = await apiRequest<Experience>("/experiences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newExperienceName.trim() })
      });
      setNewExperienceName("");
      pushToast("success", "Experience created.");
      setExperiences((prev) => [data, ...prev]);
      setSelectedExperienceId(data.id);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to create experience.");
    }
  }

  async function uploadAsset(file: File, kind: "image" | "video") {
    const sign = await apiRequest<{ uploadUrl: string; r2Key: string }>("/uploads/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        mime: file.type || "application/octet-stream",
        filename: file.name,
        size: file.size
      })
    });
    const putResponse = await fetch(sign.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": file.type || "application/octet-stream"
      },
      body: file
    });
    if (!putResponse.ok) {
      throw new Error(`Upload failed (${putResponse.status})`);
    }
    const asset = await apiRequest<{
      id: string;
      kind: string;
      r2_key: string;
      mime: string;
      size: number;
    }>("/uploads/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        r2Key: sign.r2Key,
        mime: file.type || "application/octet-stream",
        filename: file.name,
        size: file.size
      })
    });
    return asset;
  }

  async function handleCreatePair(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedExperienceId) {
      pushToast("error", "Select an experience first.");
      return;
    }
    if (!imageFile || !videoFile) {
      pushToast("error", "Image and video files are required.");
      return;
    }
    const thresholdValue = Number.parseFloat(matchThreshold);
    const priorityValue = Number.parseInt(priority, 10);
    if (Number.isNaN(thresholdValue) || Number.isNaN(priorityValue)) {
      pushToast("error", "Threshold or priority is invalid.");
      return;
    }
    setIsUploading(true);
    try {
      const imageAsset = await uploadAsset(imageFile, "image");
      const fingerprint = await generateImageFingerprint(imageFile);
      const videoAsset = await uploadAsset(videoFile, "video");
      await apiRequest(`/experiences/${selectedExperienceId}/pairs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image_asset_id: imageAsset.id,
          video_asset_id: videoAsset.id,
          image_fingerprint: fingerprint,
          match_threshold: thresholdValue,
          priority: priorityValue
        })
      });
      pushToast("success", "Pair created.");
      setImageFile(null);
      setVideoFile(null);
      await loadPairs(selectedExperienceId);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to create pair.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleCopyQr() {
    if (!selectedExperience?.qr_id) return;
    try {
      await navigator.clipboard.writeText(selectedExperience.qr_id);
      pushToast("success", "QR_ID copied.");
    } catch {
      pushToast("error", "Clipboard copy failed.");
    }
  }

  async function handleVerifyPublic() {
    if (!selectedExperience?.qr_id) return;
    setIsVerifyingPublic(true);
    try {
      const response = await fetch(`${API_BASE}/public/experience/${selectedExperience.qr_id}`);
      const text = await response.text();
      if (!response.ok) {
        throw new Error(text || `Public endpoint failed (${response.status})`);
      }
      setPublicPreview(text);
      pushToast("success", "Public endpoint verified.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Public endpoint failed.");
    } finally {
      setIsVerifyingPublic(false);
    }
  }

  if (!authChecked) {
    return (
      <main className="page">
        <div className="card">Checking session...</div>
      </main>
    );
  }

  if (!isAuthed) {
    return (
      <main className="page">
        <div className="card">
          <h1>Vidcom Admin</h1>
          <p className="muted">Log in to manage experiences and pairs.</p>
          <form onSubmit={handleLogin} className="stack">
            <label className="field">
              Email
              <input
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                required
              />
            </label>
            <label className="field">
              Password
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={isLoggingIn}>
              {isLoggingIn ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
        <ToastStack toasts={toasts} onDismiss={clearToast} />
        <AppStyles />
      </main>
    );
  }

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>Vidcom Admin</h1>
          <div className="muted">API: {API_BASE}</div>
        </div>
        <div className="header-actions">
          <div className="muted">Signed in {userEmail ? `as ${userEmail}` : ""}</div>
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <section className="grid">
        <div className="panel">
          <div className="panel-header">
            <h2>Experiences</h2>
            <button type="button" onClick={loadExperiences} disabled={isLoadingExperiences}>
              {isLoadingExperiences ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <form onSubmit={handleCreateExperience} className="stack">
            <label className="field">
              Create experience
              <input
                type="text"
                value={newExperienceName}
                onChange={(event) => setNewExperienceName(event.target.value)}
                placeholder="e.g. Summer pop-up"
              />
            </label>
            <button type="submit">Add experience</button>
          </form>
          <div className="list">
            {experiences.length === 0 && <div className="muted">No experiences yet.</div>}
            {experiences.map((exp) => (
              <button
                key={exp.id}
                type="button"
                className={`list-item ${selectedExperienceId === exp.id ? "active" : ""}`}
                onClick={() => setSelectedExperienceId(exp.id)}
              >
                <div>{exp.name}</div>
                <div className="muted">QR_ID: {exp.qr_id}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Experience Detail</h2>
          </div>
          {!selectedExperience && <div className="muted">Select an experience to view details.</div>}
          {selectedExperience && (
            <div className="stack">
              <div className="detail-row">
                <div>
                  <div className="label">Name</div>
                  <div>{selectedExperience.name}</div>
                </div>
                <div>
                  <div className="label">QR_ID</div>
                  <div className="mono">{selectedExperience.qr_id}</div>
                </div>
                <div>
                  <div className="label">Actions</div>
                  <button type="button" onClick={handleCopyQr}>
                    Copy QR_ID
                  </button>
                </div>
              </div>

              <div className="section">
                <div className="section-header">
                  <h3>Pairs</h3>
                  <button
                    type="button"
                    onClick={() => selectedExperienceId && loadPairs(selectedExperienceId)}
                    disabled={isLoadingPairs}
                  >
                    {isLoadingPairs ? "Loading..." : "Refresh pairs"}
                  </button>
                </div>
                {pairs.length === 0 && <div className="muted">No pairs yet.</div>}
                {pairs.length > 0 && (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Image Asset</th>
                        <th>Video Asset</th>
                        <th>Threshold</th>
                        <th>Priority</th>
                        <th>Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pairs.map((pair) => (
                        <tr key={pair.id}>
                          <td className="mono">{pair.id}</td>
                          <td className="mono">{pair.image_asset_id}</td>
                          <td className="mono">{pair.video_asset_id}</td>
                          <td>{pair.threshold.toFixed(2)}</td>
                          <td>{pair.priority}</td>
                          <td>{pair.is_active ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="section">
                <h3>Add Pair</h3>
                <form onSubmit={handleCreatePair} className="stack">
                  <label className="field">
                    Image file
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <label className="field">
                    Video file
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <div className="row">
                    <label className="field">
                      Match threshold
                      <input
                        type="number"
                        step="0.01"
                        value={matchThreshold}
                        onChange={(event) => setMatchThreshold(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      Priority
                      <input
                        type="number"
                        value={priority}
                        onChange={(event) => setPriority(event.target.value)}
                      />
                    </label>
                  </div>
                  <button type="submit" disabled={isUploading}>
                    {isUploading ? "Uploading..." : "Create pair"}
                  </button>
                </form>
              </div>

              <div className="section">
                <h3>Public Endpoint Check</h3>
                <div className="row">
                  <button type="button" onClick={handleVerifyPublic} disabled={isVerifyingPublic}>
                    {isVerifyingPublic ? "Checking..." : "Verify public endpoint"}
                  </button>
                </div>
                {publicPreview && (
                  <pre className="preview" aria-live="polite">
                    {publicPreview}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
      <ToastStack toasts={toasts} onDismiss={clearToast} />
      <AppStyles />
    </main>
  );
}

function ToastStack({
  toasts,
  onDismiss
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`}>
          <span>{toast.message}</span>
          <button type="button" onClick={() => onDismiss(toast.id)}>
            x
          </button>
        </div>
      ))}
    </div>
  );
}

function AppStyles() {
  return (
    <style>{`
      :root {
        color-scheme: light;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      }
      body {
        margin: 0;
        background: #f6f7fb;
        color: #1b1f2a;
      }
      .page {
        padding: 32px;
      }
      .header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        margin-bottom: 24px;
        gap: 16px;
      }
      .header-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: flex-end;
      }
      h1, h2, h3 {
        margin: 0;
      }
      h2 {
        font-size: 1.2rem;
      }
      h3 {
        font-size: 1rem;
      }
      .muted {
        color: #5c6476;
        font-size: 0.9rem;
      }
      .mono {
        font-family: "Consolas", "Courier New", monospace;
        font-size: 0.85rem;
      }
      .grid {
        display: grid;
        grid-template-columns: 320px minmax(0, 1fr);
        gap: 24px;
      }
      .panel {
        background: #ffffff;
        border-radius: 16px;
        padding: 20px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      }
      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 0.9rem;
      }
      .field input,
      .field textarea {
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid #d4d8e2;
        font-size: 0.95rem;
        background: #fff;
      }
      .list {
        margin-top: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .list-item {
        text-align: left;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid transparent;
        background: #f1f4fa;
        cursor: pointer;
      }
      .list-item.active {
        border-color: #4f46e5;
        background: #eef0ff;
      }
      .detail-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
        background: #f8f9fd;
        padding: 12px;
        border-radius: 12px;
      }
      .label {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #6b7280;
      }
      button {
        padding: 10px 14px;
        border-radius: 10px;
        border: none;
        background: #1d4ed8;
        color: white;
        font-weight: 600;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .section {
        border-top: 1px solid #e5e8f0;
        padding-top: 16px;
      }
      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;
      }
      .table th,
      .table td {
        border-bottom: 1px solid #edf0f6;
        padding: 8px;
        text-align: left;
      }
      .preview {
        margin-top: 12px;
        background: #0f172a;
        color: #e2e8f0;
        padding: 12px;
        border-radius: 12px;
        font-size: 0.8rem;
        overflow: auto;
        max-height: 260px;
      }
      .toast-stack {
        position: fixed;
        bottom: 24px;
        right: 24px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 20;
      }
      .toast {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border-radius: 12px;
        color: #0f172a;
        background: #ffffff;
        box-shadow: 0 6px 16px rgba(15, 23, 42, 0.15);
      }
      .toast.error {
        border-left: 4px solid #dc2626;
      }
      .toast.success {
        border-left: 4px solid #16a34a;
      }
      .toast.info {
        border-left: 4px solid #2563eb;
      }
      .toast button {
        background: transparent;
        color: inherit;
        padding: 0 4px;
        font-size: 1rem;
      }
      @media (max-width: 980px) {
        .grid {
          grid-template-columns: 1fr;
        }
        .header {
          flex-direction: column;
          align-items: flex-start;
        }
        .header-actions {
          align-items: flex-start;
        }
      }
    `}</style>
  );
}
