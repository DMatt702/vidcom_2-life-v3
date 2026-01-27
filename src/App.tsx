import { Routes, Route } from "react-router-dom";
import Viewer from "./viewer/Viewer";

export default () => (
  <Routes>
    <Route path="/v/:campaign/:id" element={<Viewer />} />
  </Routes>
);
