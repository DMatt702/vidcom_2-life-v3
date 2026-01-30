import { Routes, Route, Link } from "react-router-dom";
import Viewer from "./viewer/Viewer";

function Home() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>VIDCOM_2-LIFE-V3</h1>
      <p style={{ marginTop: 12, fontSize: 16, maxWidth: 720 }}>
        This is the WebAR viewer host. Use a QR link or open a viewer route directly:
      </p>

      <div style={{ marginTop: 16 }}>
        <Link to="/v/test/123" style={{ fontSize: 16 }}>
          Open sample viewer route (/v/test/123)
        </Link>
      </div>

      <p style={{ marginTop: 16, opacity: 0.8 }}>
        Once your admin panel creates an Experience, your real link will look like:
        <br />
        <code>/v/&lt;campaignSlug&gt;/&lt;experienceId&gt;</code>
      </p>
    </div>
  );
}

function NotFound() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ margin: 0 }}>Page not found</h2>
      <p style={{ marginTop: 12 }}>
        Try the viewer route: <code>/v/&lt;campaign&gt;/&lt;id&gt;</code>
      </p>
      <Link to="/">Back home</Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/v/:campaign/:id" element={<Viewer />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
