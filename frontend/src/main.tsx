import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth";
import { Toaster } from "@/components/ui/sonner";
import { DialogsProvider } from "@/components/ui/dialogs";
// index.css loads Tailwind + theme tokens and re-imports styles.css in a lower
// cascade layer, so this is the single stylesheet entry point.
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DialogsProvider>
          <App />
          <Toaster richColors position="top-right" />
        </DialogsProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
