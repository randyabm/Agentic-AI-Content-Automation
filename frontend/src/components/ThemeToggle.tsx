import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type ThemePreference = "light" | "dark" | "system";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Apply the preference to <html>. Also called inline from index.html on boot
 * (duplicated there as a tiny script) so the first paint has the right theme. */
export function applyTheme(pref: ThemePreference) {
  const dark = pref === "dark" || (pref === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem("theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}

const ORDER: ThemePreference[] = ["light", "dark", "system"];
const META: Record<ThemePreference, { icon: typeof Sun; label: string }> = {
  light: { icon: Sun, label: "Light" },
  dark: { icon: Moon, label: "Dark" },
  system: { icon: Monitor, label: "System" },
};

export function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
  const [pref, setPref] = useState<ThemePreference>(getThemePreference);

  useEffect(() => {
    localStorage.setItem("theme", pref);
    applyTheme(pref);
    if (pref !== "system") return;
    // Track OS changes live while in system mode.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
  const { icon: Icon, label } = META[pref];

  return (
    <button
      type="button"
      onClick={() => setPref(next)}
      title={`Theme: ${label} — click for ${META[next].label}`}
      aria-label={`Theme: ${label}. Switch to ${META[next].label}`}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs",
        "text-[#c7c5dd] hover:bg-white/10 hover:text-white transition-colors",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon size={14} /> {!collapsed && <span>{label} mode</span>}
    </button>
  );
}
