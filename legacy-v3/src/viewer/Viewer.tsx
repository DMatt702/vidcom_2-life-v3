import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export default function Viewer() {
  const { id } = useParams();
  const [cfg, setCfg] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/public/experience/${id}`)
      .then(r => r.json())
      .then(setCfg);
  }, [id]);

  if (!cfg) return <div>Loading AR…</div>;

  return (
    <a-scene
      mindar-image={`imageTargetSrc: ${cfg.mindarTargetUrl};`}
      embedded
      vr-mode-ui="enabled: false"
    >
      <a-camera />
      <a-entity mindar-image-target="targetIndex: 0">
        <a-video src={cfg.videoUrl} autoplay loop />
      </a-entity>
    </a-scene>
  );
}
