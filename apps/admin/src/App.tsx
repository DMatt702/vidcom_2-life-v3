import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { generateImageFingerprint, type ImageFingerprint } from "@vidcom/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";
const VIEWER_BASE = import.meta.env.VITE_VIEWER_BASE_URL ?? "https://vidcom-2-life-v3.pages.dev";

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
  mind_target_asset_id?: string;
  mind_target_status?: string | null;
  mind_target_error?: string | null;
  mind_target_requested_at?: string | null;
  mind_target_completed_at?: string | null;
  image_fingerprint: ImageFingerprint;
  threshold: number;
  priority: number;
  is_active: boolean;
  image_r2_key?: string;
  mind_r2_key?: string;
  video_r2_key?: string;
  image_url?: string;
  mind_target_url?: string;
  video_url?: string;
  image_mime?: string;
  mind_mime?: string;
  video_mime?: string;
  image_size?: number;
  mind_size?: number;
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

function filenameFromR2Key(r2Key?: string) {
  if (!r2Key) return "Unknown file";
  const lastSegment = r2Key.split("/").pop() ?? r2Key;
  if (lastSegment.length > 37 && lastSegment[36] === "-") {
    return lastSegment.slice(37);
  }
  const dashIndex = lastSegment.indexOf("-");
  return dashIndex >= 0 && dashIndex + 1 < lastSegment.length
    ? lastSegment.slice(dashIndex + 1)
    : lastSegment;
}

function sanitizeFilename(name: string) {
  const trimmed = name.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "experience";
}

function formatMindStatus(status?: string | null) {
  if (!status) return "Unknown";
  if (status === "ready") return "Ready";
  if (status === "pending") return "Generating";
  if (status === "failed") return "Failed";
  return status;
}

function mindStatusClass(status?: string | null) {
  if (status === "ready") return "status-ready";
  if (status === "pending") return "status-pending";
  if (status === "failed") return "status-failed";
  return "status-unknown";
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
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [matchThreshold, setMatchThreshold] = useState("0.8");
  const [priority, setPriority] = useState("0");
  const [isUploading, setIsUploading] = useState(false);
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [assignQrId, setAssignQrId] = useState("");
  const [isAssigningQrId, setIsAssigningQrId] = useState(false);

  const [publicPreview, setPublicPreview] = useState<string>("");
  const [isVerifyingPublic, setIsVerifyingPublic] = useState(false);

  const isAuthed = Boolean(token);
  const selectedExperience = useMemo(
    () => experiences.find((exp) => exp.id === selectedExperienceId) ?? experienceDetail,
    [experiences, experienceDetail, selectedExperienceId]
  );
  const sharesQrId = useMemo(() => {
    if (!selectedExperience) return false;
    return experiences.filter((exp) => exp.qr_id === selectedExperience.qr_id).length > 1;
  }, [experiences, selectedExperience]);

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
      setMoveTargets({});
      return;
    }
    loadExperienceDetail(selectedExperienceId);
    loadPairs(selectedExperienceId);
    setMoveTargets({});
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
    const selectedImage = imageFile ?? imageInputRef.current?.files?.[0] ?? null;
    const selectedVideo = videoFile ?? videoInputRef.current?.files?.[0] ?? null;
    if (!selectedImage) {
      setImageError("Image is required.");
    }
    if (!selectedVideo) {
      setVideoError("Video is required.");
    }
    if (!selectedImage || !selectedVideo) {
      return;
    }
    setImageError(null);
    setVideoError(null);
    const thresholdValue = Number.parseFloat(matchThreshold);
    const priorityValue = Number.parseInt(priority, 10);
    if (Number.isNaN(thresholdValue) || Number.isNaN(priorityValue)) {
      pushToast("error", "Threshold or priority is invalid.");
      return;
    }
    setIsUploading(true);
    try {
      const imageAsset = await uploadAsset(selectedImage, "image");
      const fingerprint = await generateImageFingerprint(selectedImage);
      const videoAsset = await uploadAsset(selectedVideo, "video");
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
      if (imageInputRef.current) imageInputRef.current.value = "";
      if (videoInputRef.current) videoInputRef.current.value = "";
      await loadPairs(selectedExperienceId);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to create pair.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDownloadQr() {
    if (!selectedExperience?.qr_id) return;
    try {
      const viewerUrl = `${VIEWER_BASE}/v/${selectedExperience.qr_id}`;
      const dataUrl = await QRCode.toDataURL(viewerUrl, {
        width: 1024,
        margin: 2,
        errorCorrectionLevel: "H"
      });
      const fileName = `${sanitizeFilename(selectedExperience.name)}-qr-${selectedExperience.qr_id}.png`;
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = fileName;
      link.click();
      link.remove();
      pushToast("success", "QR PNG downloaded.");
    } catch {
      pushToast("error", "QR download failed.");
    }
  }

  async function handleAssignQrId() {
    if (!selectedExperience) return;
    const nextQrId = assignQrId.trim();
    if (!nextQrId) {
      pushToast("error", "QR_ID is required.");
      return;
    }
    setIsAssigningQrId(true);
    try {
      const updated = await apiRequest<Experience>(`/experiences/${selectedExperience.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ qr_id: nextQrId })
      });
      setExperiences((prev) => prev.map((exp) => (exp.id === updated.id ? updated : exp)));
      setExperienceDetail(updated);
      setAssignQrId("");
      pushToast("success", "QR_ID assigned.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to assign QR_ID.");
    } finally {
      setIsAssigningQrId(false);
    }
  }

  async function handleToggleExperience() {
    if (!selectedExperience) return;
    const nextValue = !selectedExperience.is_active;
    try {
      const updated = await apiRequest<Experience>(`/experiences/${selectedExperience.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: nextValue })
      });
      setExperiences((prev) =>
        prev.map((exp) => (exp.id === updated.id ? updated : exp))
      );
      setExperienceDetail(updated);
      pushToast("success", `Experience ${nextValue ? "activated" : "deactivated"}.`);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to update experience.");
    }
  }

  async function handleDeleteExperience() {
    if (!selectedExperience) return;
    const confirmed = window.confirm(
      `Delete experience "${selectedExperience.name}" and all its pairs? This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await apiRequest(`/experiences/${selectedExperience.id}`, { method: "DELETE" });
      pushToast("success", "Experience deleted.");
      setExperiences((prev) => prev.filter((exp) => exp.id !== selectedExperience.id));
      setPairs([]);
      setExperienceDetail(null);
      setSelectedExperienceId((prevSelected) => {
        if (prevSelected !== selectedExperience.id) return prevSelected;
        const remaining = experiences.filter((exp) => exp.id !== selectedExperience.id);
        return remaining[0]?.id ?? null;
      });
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to delete experience.");
    }
  }

  async function handleDeletePair(pairId: string) {
    const confirmed = window.confirm("Delete this pair? This cannot be undone.");
    if (!confirmed) return;
    try {
      await apiRequest(`/pairs/${pairId}`, { method: "DELETE" });
      pushToast("success", "Pair deleted.");
      if (selectedExperienceId) {
        await loadPairs(selectedExperienceId);
      }
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to delete pair.");
    }
  }

  async function handleMovePair(pairId: string) {
    const targetId = moveTargets[pairId];
    if (!targetId || targetId === selectedExperienceId) return;
    try {
      await apiRequest(`/pairs/${pairId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ experience_id: targetId })
      });
      pushToast("success", "Pair moved.");
      setMoveTargets((prev) => {
        const next = { ...prev };
        delete next[pairId];
        return next;
      });
      if (selectedExperienceId) {
        await loadPairs(selectedExperienceId);
      }
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to move pair.");
    }
  }

  async function handleRetryMindar(pair: Pair) {
    if (!pair.image_asset_id) {
      pushToast("error", "Pair is missing image asset.");
      return;
    }
    try {
      await apiRequest("/jobs/mindar/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pairId: pair.id, image_asset_id: pair.image_asset_id })
      });
      pushToast("info", "MindAR generation dispatched.");
      if (selectedExperienceId) {
        await loadPairs(selectedExperienceId);
      }
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to dispatch MindAR job.");
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
              <div className="experience-header">
                <div>
                  <div className="label">Current Experience</div>
                  <h3>{selectedExperience.name}</h3>
                  <div className="muted">
                    QR_ID: <span className="mono">{selectedExperience.qr_id}</span>
                  </div>
                  {sharesQrId && (
                    <div className="note">This experience shares QR_ID with other experiences.</div>
                  )}
                </div>
                <div className="experience-actions">
                  <span className={`badge ${selectedExperience.is_active ? "active" : "inactive"}`}>
                    {selectedExperience.is_active ? "Active" : "Inactive"}
                  </span>
                  <button type="button" onClick={handleDownloadQr}>
                    Download QR (PNG)
                  </button>
                  <button type="button" className="secondary" onClick={handleToggleExperience}>
                    {selectedExperience.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button type="button" className="danger" onClick={handleDeleteExperience}>
                    Delete Experience
                  </button>
                </div>
              </div>

              <div className="section">
                <h3>Assign existing QR_ID</h3>
                <div className="row">
                  <label className="field">
                    QR_ID
                    <input
                      type="text"
                      value={assignQrId}
                      onChange={(event) => setAssignQrId(event.target.value)}
                      placeholder="Paste QR_ID to share"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleAssignQrId}
                    disabled={!assignQrId.trim() || isAssigningQrId}
                  >
                    {isAssigningQrId ? "Assigning..." : "Assign"}
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
                        <th>Image</th>
                        <th>Video</th>
                        <th>Target</th>
                        <th>Threshold</th>
                        <th>Priority</th>
                        <th>Active</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pairs.map((pair) => (
                        <tr key={pair.id}>
                          <td className="mono">{pair.id}</td>
                          <td>
                            <div className="pair-media">
                              {pair.image_url ? (
                                <img
                                  className="thumb"
                                  src={pair.image_url}
                                  alt={`Pair ${pair.id} thumbnail`}
                                  loading="lazy"
                                />
                              ) : (
                                <div className="thumb placeholder">No image</div>
                              )}
                              <div className="file-meta mono">{pair.image_asset_id}</div>
                            </div>
                          </td>
                          <td>
                            <div className="pair-media">
                              <div className="file-meta">
                                <span className="file-icon" aria-hidden="true">🎬</span>
                                <span>{filenameFromR2Key(pair.video_r2_key)}</span>
                              </div>
                              <div className="mono">{pair.video_asset_id}</div>
                              {pair.video_url ? (
                                <>
                                  <a className="link" href={pair.video_url} target="_blank" rel="noreferrer">
                                    View
                                  </a>
                                  <video
                                    className="thumb"
                                    src={pair.video_url}
                                    controls
                                    muted
                                    playsInline
                                    preload="metadata"
                                  />
                                </>
                              ) : (
                                <span className="muted">No signed URL</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="stack">
                              <span className={`status-pill ${mindStatusClass(pair.mind_target_status)}`}>
                                {formatMindStatus(pair.mind_target_status)}
                              </span>
                              {pair.mind_target_error && (
                                <span className="muted small">{pair.mind_target_error}</span>
                              )}
                              <button
                                type="button"
                                className="secondary tiny"
                                onClick={() => handleRetryMindar(pair)}
                                disabled={!pair.image_asset_id}
                              >
                                Retry
                              </button>
                            </div>
                          </td>
                          <td>{pair.threshold.toFixed(2)}</td>

                          <td>{pair.priority}</td>
                          <td>{pair.is_active ? "Yes" : "No"}</td>
                          <td>
                            <div className="pair-actions">
                              <select
                                value={moveTargets[pair.id] ?? ""}
                                onChange={(event) =>
                                  setMoveTargets((prev) => ({
                                    ...prev,
                                    [pair.id]: event.target.value
                                  }))
                                }
                              >
                                <option value="">Move to...</option>
                                {experiences.map((exp) => (
                                  <option key={exp.id} value={exp.id}>
                                    {exp.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="secondary"
                                disabled={
                                  !moveTargets[pair.id] ||
                                  moveTargets[pair.id] === selectedExperienceId
                                }
                                onClick={() => handleMovePair(pair.id)}
                              >
                                Move
                              </button>
                              <button
                                type="button"
                                className="danger"
                                onClick={() => handleDeletePair(pair.id)}
                              >
                                Delete pair
                              </button>
                            </div>
                          </td>
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
                      ref={imageInputRef}
                      onChange={(event) => {
                        setImageFile(event.target.files?.[0] ?? null);
                        setImageError(null);
                      }}
                    />
                    {imageError && <span className="inline-error">{imageError}</span>}
                  </label>
                  <label className="field">
                    Video file
                    <input
                      type="file"
                      accept="video/*"
                      ref={videoInputRef}
                      onChange={(event) => {
                        setVideoFile(event.target.files?.[0] ?? null);
                        setVideoError(null);
                      }}
                    />
                    {videoError && <span className="inline-error">{videoError}</span>}
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
      .note {
        margin-top: 6px;
        font-size: 0.8rem;
        color: #1d4ed8;
        font-weight: 600;
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
      .experience-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        background: #f8f9fd;
        padding: 16px;
        border-radius: 12px;
      }
      .experience-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: flex-end;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 600;
      }
      .badge.active {
        background: #dcfce7;
        color: #166534;
      }
      .badge.inactive {
        background: #fee2e2;
        color: #991b1b;
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 600;
        width: fit-content;
      }
      .status-ready {
        background: #dcfce7;
        color: #166534;
      }
      .status-pending {
        background: #fde68a;
        color: #92400e;
      }
      .status-failed {
        background: #fee2e2;
        color: #991b1b;
      }
      .status-unknown {
        background: #e2e8f0;
        color: #0f172a;
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
      button.secondary {
        background: #e2e8f0;
        color: #0f172a;
      }
      button.tiny {
        padding: 6px 10px;
        border-radius: 8px;
        font-size: 0.75rem;
      }
      button.danger {
        background: #dc2626;
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      select {
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid #d4d8e2;
        background: #fff;
        font-size: 0.85rem;
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
        vertical-align: top;
      }
      .pair-media {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .thumb {
        width: 80px;
        height: 60px;
        object-fit: cover;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        background: #f1f5f9;
      }
      .thumb.placeholder {
        display: grid;
        place-items: center;
        font-size: 0.7rem;
        color: #64748b;
      }
      .file-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8rem;
      }
      .file-icon {
        font-size: 1rem;
      }
      .pair-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: flex-start;
      }
      .link {
        color: #1d4ed8;
        font-weight: 600;
        text-decoration: none;
      }
      .inline-error {
        color: #dc2626;
        font-size: 0.8rem;
      }
      .small {
        font-size: 0.75rem;
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
        .experience-actions {
          align-items: flex-start;
        }
      }
    `}</style>
  );
}
