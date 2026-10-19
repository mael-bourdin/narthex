import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import geist from "@geist-fonts/geist-sans/Geist-Variable.woff2?url";
import { App } from "./App.tsx";
import "./styles.css";

const font = new FontFace("Geist", `url(${geist})`, { weight: "100 900" });
void font.load().then((f) => document.fonts.add(f));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
