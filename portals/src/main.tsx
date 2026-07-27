import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../app/globals.css";
import "./portals.css";
import { PortalsApp } from "./PortalsApp";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PortalsApp />
  </StrictMode>,
);
