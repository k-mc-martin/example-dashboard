import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import Dashboard from "@/components/dashboard";
import "@/app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Dashboard root element is missing.");

createRoot(root).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
);
