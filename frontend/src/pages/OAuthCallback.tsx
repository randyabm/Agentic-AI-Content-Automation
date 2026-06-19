import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

export default function OAuthCallback() {
  const [params] = useSearchParams();
  const status = params.get("status") ?? "ok";
  const platform = params.get("platform") ?? "";
  const clientId = params.get("client_id") ?? "";
  const count = params.get("count") ?? "1";
  const errorMsg = params.get("error") ?? "Unknown error";
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (status === "ok" && window.opener) {
      window.opener.postMessage(
        { type: "oauth_connected", platform, client_id: clientId, count: Number(count) },
        window.location.origin,
      );
      const t = setTimeout(() => {
        window.close();
        setClosed(true);
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [status, platform, clientId, count]);

  const label = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "Account";

  if (status === "ok") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 16, fontFamily: "system-ui, sans-serif" }}>
        <div style={{ fontSize: 48 }}>✅</div>
        <h2 style={{ margin: 0 }}>
          {label} connected{Number(count) > 1 ? ` (${count} accounts)` : ""}
        </h2>
        <p style={{ color: "#6b7280", margin: 0 }}>
          {closed ? "This tab has been closed." : "Closing this tab…"}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ fontSize: 48 }}>❌</div>
      <h2 style={{ margin: 0 }}>Connection failed</h2>
      <p style={{ color: "#6b7280", margin: 0, maxWidth: 400, textAlign: "center" }}>{decodeURIComponent(errorMsg)}</p>
      <button onClick={() => window.close()} style={{ padding: "8px 16px", cursor: "pointer" }}>
        Close tab
      </button>
    </div>
  );
}
