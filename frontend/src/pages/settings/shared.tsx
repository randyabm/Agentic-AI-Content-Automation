import { useEffect, useState } from "react";
import { api } from "../../api";
import type { ProviderModel } from "../../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Provider option lists shared across the model/LLM sections.
export const LLM_PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI" },
  { value: "openrouter", label: "OpenRouter" },
];
export const IMAGE_PROVIDERS = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "openai", label: "OpenAI" },
  { value: "openai_responses", label: "OpenAI (Responses / GPT-5.x)" },
  { value: "magnific", label: "Magnific" },
];
export const VIDEO_PROVIDERS = [
  { value: "google_veo", label: "Google Veo (Gemini API)" },
  { value: "openai_sora", label: "OpenAI Sora" },
  { value: "fal", label: "fal.ai" },
  { value: "replicate", label: "Replicate" },
  { value: "magnific", label: "Magnific" },
];

export type SocialAppStatus = {
  provider: string;
  label: string;
  has_app_id: boolean;
  has_app_secret: boolean;
  app_id_hint: string;
};

export const SOCIAL_APP_PLATFORMS: { provider: string; label: string; idLabel: string; secretLabel: string }[] = [
  { provider: "oauth_facebook", label: "Facebook", idLabel: "App ID", secretLabel: "App Secret" },
  { provider: "oauth_instagram", label: "Instagram", idLabel: "App ID", secretLabel: "App Secret" },
  { provider: "oauth_twitter", label: "Twitter / X", idLabel: "Client ID", secretLabel: "Client Secret" },
  { provider: "oauth_linkedin", label: "LinkedIn", idLabel: "Client ID", secretLabel: "Client Secret" },
];

export function Alert({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) {
  if (kind === "error") {
    return <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{children}</div>;
  }
  return <div className="rounded-lg border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{children}</div>;
}

export function SettingsGroup({ title, description, accent, children }: { title: string; description: string; accent: string; children: React.ReactNode }) {
  return (
    <div
      className="mt-6 overflow-hidden rounded-lg border border-border border-l-4 bg-surface shadow-sm first:mt-4"
      style={{ borderLeftColor: accent }}
    >
      <div
        className="border-b border-border px-4 py-3"
        style={{ backgroundColor: `color-mix(in srgb, ${accent} 8%, var(--surface))` }}
      >
        <h3 className="m-0" style={{ color: accent }}>{title}</h3>
        {description && <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  );
}

export function ModelSelect({
  provider,
  kind,
  value,
  onChange,
  onModelName,
}: {
  provider: string;
  kind: "text" | "image" | "video";
  value: string;
  onChange: (id: string) => void;
  onModelName?: (name: string) => void;
}) {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [manual, setManual] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr("");
    api<ProviderModel[]>(`/providers/${provider}/models?kind=${kind}`)
      .then((m) => {
        if (cancelled) return;
        setModels(m);
        setManual(m.length === 0);
      })
      .catch((e) => {
        if (cancelled) return;
        setModels([]);
        setManual(true);
        setErr(e instanceof Error ? e.message : "Could not load models");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [provider, kind]);

  if (manual) {
    return (
      <div className="space-y-1.5">
        <Input
          placeholder="Type the model ID"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onModelName?.(e.target.value);
          }}
        />
        {models.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setManual(false)}>
            Pick from list
          </Button>
        )}
        {err && <div className="text-xs text-muted-foreground">{err} — enter the model ID manually.</div>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          const found = models.find((m) => m.id === e.target.value);
          onModelName?.(found?.name || e.target.value);
        }}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">{loading ? "Loading models…" : "— select a model —"}</option>
        {value && !models.some((m) => m.id === value) && <option value={value}>{value}</option>}
        {models.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
      </select>
      <Button type="button" variant="ghost" size="sm" onClick={() => setManual(true)}>
        Enter manually
      </Button>
    </div>
  );
}
