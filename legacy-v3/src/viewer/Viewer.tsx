import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ??
  "https://vidcom-api-staging.vidcomfilmworks.workers.dev";

export default function Viewer() {
  const { id } = useParams();
  const [cfg, setCfg] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading target...");
  const navigate = useNavigate();

  const targetRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sceneRef = useRef<any>(null);

  const qrId = useMemo(() => (id ? String(id) : ""), [id]);

  useEffect(() => {
    if (!qrId) return;
    setCfg(null);
    setError(null);
    setStatus("Loading target...");
    fetch(`${API_BASE}/public/experience/${encodeURIComponent(qrId)}`)
      .then(async (r) => {
        const text = await r.text();
        const data = text ? JSON.parse(text) : null;
        if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
        return data;
      })
      .then((data) => {
        setCfg(data);
        if (data?.mind_target_status === "pending") {
          setStatus("Preparing target...");
        } else if (data?.mind_target_status === "failed") {
          setStatus("Target failed");
        } else {
          setStatus("Scanning...");
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setStatus("Error");
      });
  }, [qrId]);

  const experience = cfg?.experience;
  const mindarTargetUrl = cfg?.mindarTargetUrl ?? null;
  const videoUrl = cfg?.videoUrl ?? null;

  useEffect(() => {
    if (!mindarTargetUrl || !videoUrl) return;
    const targetEl = targetRef.current as HTMLElement | null;
    const videoEl = videoRef.current;
    if (!targetEl || !videoEl) return;
    videoEl.pause();
    videoEl.muted = true;
    videoEl.currentTime = 0;

    const handleFound = async () => {
      try {
        videoEl.muted = true;
        await videoEl.play();
        setStatus("Target found");
      } catch {
        setStatus("Target found (video blocked)");
      }
    };

    const handleLost = () => {
      videoEl.pause();
      videoEl.muted = true;
      setStatus("Scanning...");
    };

    targetEl.addEventListener("targetFound", handleFound);
    targetEl.addEventListener("targetLost", handleLost);

    return () => {
      targetEl.removeEventListener("targetFound", handleFound);
      targetEl.removeEventListener("targetLost", handleLost);
    };
  }, [mindarTargetUrl, videoUrl]);

  useEffect(() => {
    if (!mindarTargetUrl || !videoUrl) return;
    const sceneEl = sceneRef.current as any;
    if (!sceneEl) return;
    const handleRenderStart = () => {
      try {
        if (sceneEl.renderer) {
          sceneEl.renderer.setClearColor(0x000000, 0);
          sceneEl.renderer.clearColor();
        }
      } catch {}
    };
    sceneEl.addEventListener("renderstart", handleRenderStart);
    const id = window.setTimeout(() => {
      try {
        sceneEl?.systems?.["mindar-image-system"]?.start?.();
        setStatus("Scanning...");
      } catch {}
    }, 800);
    return () => {
      sceneEl.removeEventListener("renderstart", handleRenderStart);
      window.clearTimeout(id);
    };
  }, [mindarTargetUrl, videoUrl]);

  if (!qrId) return <div>Missing QR ID.</div>;
  if (error) return <div>Error: {error}</div>;
  if (!cfg) return <div>Loading viewer...</div>;

  if (!mindarTargetUrl || !videoUrl) {
    const targetStatus = cfg?.mind_target_status ?? null;
    let message = "No AR media configured for this experience yet.";
    if (targetStatus === "pending") {
      message = "Target is being prepared. Please try again in a minute.";
    } else if (targetStatus === "failed") {
      message = "Target generation failed. Please retry in Admin.";
    }
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", minHeight: "100vh" }}>
        <h2 style={{ margin: 0 }}>Vidcom Viewer (v4)</h2>
        <p style={{ marginTop: 12 }}>
          Experience: <strong>{experience?.name ?? "Unknown"}</strong>
        </p>
        <p style={{ marginTop: 8, opacity: 0.8 }}>
          QR_ID: <code>{experience?.qr_id ?? qrId}</code>
        </p>
        <p style={{ marginTop: 16 }}>{message}</p>
        <button
          type="button"
          onClick={() => navigate("/scan")}
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "12px 20px",
            borderRadius: 999,
            border: "none",
            background: "#1d4ed8",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          Reset Scanner
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", position: "relative", background: "#000" }}>
      <div
        style={{
          position: "fixed",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "6px 12px",
          borderRadius: 999,
          background: "rgba(0,0,0,0.6)",
          color: "#fff",
          fontSize: 12,
          zIndex: 20,
        }}
      >
        {status}
      </div>
      <a-scene
        ref={sceneRef}
        mindar-image={`imageTargetSrc: ${mindarTargetUrl}; uiLoading: false; uiScanning: false; uiError: false;`}
        embedded
        background="transparent: true"
        renderer="alpha: true; antialias: true; logarithmicDepthBuffer: true"
        vr-mode-ui="enabled: false"
        style={{ position: "fixed", inset: 0, zIndex: 1 }}
      >
        <a-assets>
          <video
            id="ar-video"
            ref={videoRef}
            src={videoUrl}
            preload="auto"
            muted
            playsInline
            crossOrigin="anonymous"
            style={{ display: "none" }}
          />
        </a-assets>
        <a-camera />
        <a-entity ref={targetRef} mindar-image-target="targetIndex: 0">
          <a-video src="#ar-video" loop="true" />
        </a-entity>
      </a-scene>
      <style>{`
        html, body, #root {
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
          background: #000;
        }
        .mindar-ui-overlay,
        .mindar-ui-loading,
        .mindar-ui-scanning,
        .mindar-ui-error {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
        a-scene, a-scene canvas {
          position: fixed !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          z-index: 1 !important;
          background: transparent !important;
        }
        canvas {
          background: transparent !important;
        }
        video, .mindar-video, video#mindar-video {
          position: fixed !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          z-index: 0 !important;
        }
        canvas {
          background: transparent !important;
        }
      `}</style>
      <button
        type="button"
        onClick={() => navigate("/scan")}
        style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "12px 20px",
          borderRadius: 999,
          border: "none",
          background: "rgba(0,0,0,0.65)",
          color: "#fff",
          fontWeight: 600,
          backdropFilter: "blur(6px)",
          zIndex: 20,
        }}
      >
        Reset Scanner
      </button>
    </div>
  );
}
