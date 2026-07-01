/** Shared metadata for all 16 Visual Agent style families. */

export const STYLE_FAMILY_LABEL: Record<string, string> = {
  // Original 6
  bold_typographic: "Bold typographic",
  lifestyle_ugc: "Lifestyle UGC",
  editorial_collage: "Editorial collage",
  "3d_product_hero": "3D product hero",
  imperfect_hand_drawn: "Imperfect hand-drawn",
  surreal_seasonal_scene: "Surreal seasonal",
  // 2025-2026 additions
  glassmorphism_layered: "Glassmorphism",
  neo_brutalist_web: "Neo-brutalist",
  y2k_retro_futurism: "Y2K retro-futurism",
  dark_mode_luxury: "Dark-mode luxury",
  claymorphism_soft_3d: "Claymorphism",
  maximalist_eclectic_collage: "Maximalist collage",
  swiss_international_minimal: "Swiss minimal",
  gradient_mesh_abstract: "Gradient mesh",
  organic_blob_botanical: "Organic botanical",
  kinetic_motion_typography: "Kinetic motion",
};

export const STYLE_FAMILY_TINT: Record<string, string> = {
  // Original 6
  bold_typographic: "from-fuchsia-500 to-rose-500",
  lifestyle_ugc: "from-amber-400 to-orange-500",
  editorial_collage: "from-emerald-400 to-teal-500",
  "3d_product_hero": "from-sky-400 to-indigo-500",
  imperfect_hand_drawn: "from-rose-300 to-pink-400",
  surreal_seasonal_scene: "from-violet-400 to-purple-500",
  // 2025-2026 additions
  glassmorphism_layered: "from-cyan-300 to-blue-500",
  neo_brutalist_web: "from-yellow-400 to-black",
  y2k_retro_futurism: "from-pink-400 to-purple-600",
  dark_mode_luxury: "from-zinc-800 to-yellow-600",
  claymorphism_soft_3d: "from-sky-200 to-teal-300",
  maximalist_eclectic_collage: "from-orange-400 to-pink-500",
  swiss_international_minimal: "from-gray-700 to-gray-400",
  gradient_mesh_abstract: "from-violet-400 to-emerald-400",
  organic_blob_botanical: "from-lime-400 to-amber-400",
  kinetic_motion_typography: "from-orange-500 to-red-600",
};

export const FAMILY_ACCENT_BORDER: Record<string, string> = {
  // Original 6
  bold_typographic: "ring-fuchsia-300",
  lifestyle_ugc: "ring-amber-300",
  editorial_collage: "ring-emerald-300",
  "3d_product_hero": "ring-sky-300",
  imperfect_hand_drawn: "ring-rose-300",
  surreal_seasonal_scene: "ring-violet-300",
  // 2025-2026 additions
  glassmorphism_layered: "ring-cyan-300",
  neo_brutalist_web: "ring-yellow-400",
  y2k_retro_futurism: "ring-pink-400",
  dark_mode_luxury: "ring-yellow-500",
  claymorphism_soft_3d: "ring-sky-300",
  maximalist_eclectic_collage: "ring-orange-400",
  swiss_international_minimal: "ring-gray-400",
  gradient_mesh_abstract: "ring-violet-400",
  organic_blob_botanical: "ring-lime-400",
  kinetic_motion_typography: "ring-orange-400",
};

/** Returns a human-readable label for a style_family slug.
 *  Handles single families and remix pairs (e.g. "a+b"). */
export function styleFamilyLabel(slug: string | null | undefined): string {
  if (!slug) return "";
  if (slug.includes("+")) {
    const [a, b] = slug.split("+", 2);
    return `${STYLE_FAMILY_LABEL[a] ?? a} + ${STYLE_FAMILY_LABEL[b] ?? b}`;
  }
  return STYLE_FAMILY_LABEL[slug] ?? slug.replace(/_/g, " ");
}

/** Returns the Tailwind gradient tint class for a style_family slug (including remix pairs). */
export function styleFamilyTint(slug: string | null | undefined): string {
  if (!slug) return "from-slate-400 to-slate-600";
  const primaryFamily = slug.includes("+") ? slug.split("+")[0] : slug;
  return STYLE_FAMILY_TINT[primaryFamily] ?? "from-slate-400 to-slate-600";
}

/** Returns true when the slug represents a remix (two families joined by '+'). */
export function isRemix(slug: string | null | undefined): boolean {
  return !!slug && slug.includes("+");
}
