import React from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import "@fontsource/fira-sans/latin-400.css";
import "@fontsource/fira-sans/latin-500.css";
import "@fontsource/fira-sans/latin-600.css";
import "@fontsource/fira-mono/latin-400.css";
import "./styles.css";
import { nbpraTheme } from "./theme";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FluentProvider theme={nbpraTheme} style={{ background: "transparent" }}>
      <App />
    </FluentProvider>
  </React.StrictMode>,
);
