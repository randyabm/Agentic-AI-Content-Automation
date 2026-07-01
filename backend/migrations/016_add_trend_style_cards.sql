-- Migration 016: Seed 10 new style cards (2025-2026 design trends) into the
-- Visual Agent's curated style library, expanding it from 6 to 16 families.
--
-- Idempotent: ON CONFLICT (id) DO NOTHING mirrors the same rows that seed.py
-- inserts on boot, so whichever runs first wins and the other is a no-op.
-- Safe to apply to a live DB that seed.py already seeded on startup.

INSERT INTO style_cards (id, name, family, description, best_for, not_for, visual_cues, negative_constraints, is_global, is_active)
VALUES
(
  'glassmorphism_layered',
  'Glassmorphism / frosted layers',
  'glassmorphism_layered',
  'Frosted-glass translucent panels stacked over a vivid blurred background, soft inner glow, thin light-catching borders. For SaaS dashboards, fintech, and premium digital-product launches that want a futuristic-but-light feel.',
  ARRAY['SaaS dashboards', 'Fintech', 'Premium digital products', 'App feature highlights', 'Subscription launches'],
  ARRAY['Heritage/legacy brands', 'Print-feel campaigns', 'Hand-crafted or artisanal positioning'],
  ARRAY[
    '2-3 translucent frosted-glass panels at different depths, soft blur behind each',
    'vivid blurred gradient background (saturated colour bleed) visible through the glass',
    'thin 1px light-catching border on each glass panel edge',
    'soft inner glow / highlight along the top edge of each panel (simulated light source)',
    'UI elements or product mockup rendered as if floating inside one glass panel',
    'subtle drop shadow beneath each panel for depth separation',
    'cool-to-vivid colour pairing (e.g. icy blue + violet, mint + magenta)',
    'headline rendered on the frontmost, most-opaque panel for legibility'
  ],
  ARRAY[
    'no opaque flat cards (translucency is the entire point)',
    'no muddy/low-contrast glass (panels must stay legible against the background)',
    'no more than 3 stacked panels (clutter kills the effect)',
    'no flat illustration (this is a rendered-depth style)',
    'no AI-looking perfection on the blur (slight imperfection in the blur edge is fine)'
  ],
  TRUE, TRUE
),
(
  'neo_brutalist_web',
  'Neo-brutalist / raw web-core',
  'neo_brutalist_web',
  'Raw, unpolished, high-contrast layout inspired by early-web and brutalist graphic design: thick black borders, harsh drop shadows, clashing flat colours, deliberately ''undesigned'' grid. For brands that want to look confident, anti-corporate, and culturally current.',
  ARRAY['Streetwear / youth brands', 'Music / events', 'Indie tech products', 'Anti-corporate positioning', 'Gen-Z audiences'],
  ARRAY['Healthcare / finance / legal', 'Luxury brands', 'Trust-first B2B'],
  ARRAY[
    'thick (8-12px) solid black border around the main content block',
    'harsh, offset drop shadow (hard edge, not soft blur) behind cards/buttons',
    'flat, clashing colour blocks (e.g. acid yellow + electric blue + black, no gradients)',
    'deliberately raw/grid-breaking layout — elements slightly mis-aligned on purpose',
    'monospace or oversized condensed sans headline, no decorative font flourishes',
    'visible ''underline'' or ''box'' around key words instead of colour emphasis',
    'flat 2D shapes (no shadows on shapes themselves, only on cards)',
    'high contrast only — no soft mid-tones'
  ],
  ARRAY[
    'no gradients anywhere (flat colour only)',
    'no soft drop shadows (shadows must be hard-edged and offset)',
    'no rounded corners on the main border (sharp corners only)',
    'no muted or pastel palette (high-saturation clashing colours required)',
    'no polished/premium feel (rawness is the brand asset)'
  ],
  TRUE, TRUE
),
(
  'y2k_retro_futurism',
  'Y2K / retro-futurism',
  'y2k_retro_futurism',
  'Late-90s/early-2000s digital optimism: chrome/metallic gradients, bubble shapes, pixel/glow accents, holographic sheen. For youth brands, nostalgia plays, and playful product drops.',
  ARRAY['Gen-Z / youth brands', 'Music / entertainment', 'Nostalgia campaigns', 'Playful product drops', 'Beauty / fashion'],
  ARRAY['B2B / enterprise', 'Finance / legal', 'Serious / regulated topics'],
  ARRAY[
    'chrome/metallic gradient text or shapes (silver-to-blue-to-pink sheen)',
    'holographic/iridescent foil texture on at least one element',
    'bubble or blob-shaped UI frames (rounded, candy-like)',
    'low-poly or pixel-art accents as decorative detail (not the whole image)',
    'starburst, swirl, or lens-flare accents',
    'saturated candy colour palette (cyber-lilac, bubblegum pink, acid lime)',
    'thin chrome outline on the headline typography',
    'subtle scanline or CRT-glow texture on a background element'
  ],
  ARRAY[
    'no muted/earthy palette (saturation is mandatory)',
    'no minimalist negative space (the frame should feel maximal/busy in a fun way)',
    'no modern flat-UI mockups (this style predates flat design — keep skeuomorphic chrome)',
    'no corporate tone in colour choice'
  ],
  TRUE, TRUE
),
(
  'dark_mode_luxury',
  'Dark-mode luxury',
  'dark_mode_luxury',
  'Near-black or deep charcoal background, single metallic accent (gold, copper, or champagne), generous negative space, refined thin-weight serif or geometric type. For premium/high-ticket products, finance, and exclusive offers.',
  ARRAY['Luxury goods', 'Finance / wealth management', 'Premium memberships', 'High-ticket B2B', 'Exclusive / VIP offers'],
  ARRAY['Budget / value positioning', 'Playful or youth brands', 'High-information-density layouts'],
  ARRAY[
    'near-black (#0a0a0a–#161616) or deep charcoal background, not pure black',
    'single metallic accent colour (gold, copper, or champagne) used sparingly',
    'generous negative space — subject occupies well under half the canvas',
    'thin-weight serif or geometric sans headline (weight 300-400, NOT bold)',
    'subtle gold or hairline rule dividing sections',
    'soft, directional studio light on the hero subject only (rest stays dark)',
    'matte material rendering, minimal reflections except on the metallic accent',
    'centred or rule-of-thirds composition, never cluttered'
  ],
  ARRAY[
    'no more than one accent colour besides black/white',
    'no bold/heavy typography (heaviness reads as cheap, not premium)',
    'no busy backgrounds or competing visual elements',
    'no bright saturated colours anywhere',
    'no flat illustration (must read as photographic/rendered depth)'
  ],
  TRUE, TRUE
),
(
  'claymorphism_soft_3d',
  'Claymorphism / soft-3D',
  'claymorphism_soft_3d',
  'Puffy, matte, clay-like 3D shapes with soft rounded edges and gentle inset/outset shadows — looks tactile, friendly, and premium-casual. For consumer apps, wellness, and friendly fintech.',
  ARRAY['Consumer apps', 'Wellness / health', 'Friendly fintech', 'Onboarding / explainer visuals', 'Family-friendly brands'],
  ARRAY['Heritage / luxury brands', 'Serious B2B', 'Editorial / text-heavy content'],
  ARRAY[
    'matte clay-like material on every 3D shape (no glossy/reflective surfaces)',
    'soft, heavily rounded edges on every shape (no sharp corners)',
    'dual shadow technique: soft inset shadow + soft outset shadow per shape (puffy look)',
    'pastel or muted-saturated colour palette (soft blue, soft coral, soft mint)',
    'simple geometric clay shapes (rounded blobs, pill shapes, soft cubes) as props',
    'even, soft diffused lighting — no hard highlights',
    'playful, slightly oversized proportions on hero objects',
    'flat-matte background in a single soft colour or very subtle gradient'
  ],
  ARRAY[
    'no glossy or reflective materials (matte only — polar opposite of 3d_product_hero)',
    'no sharp edges or corners anywhere',
    'no hard shadows (every shadow must be soft and diffused)',
    'no photographic textures (this is a rendered/illustrated style)',
    'no dark or moody palette (claymorphism reads as light and friendly)'
  ],
  TRUE, TRUE
),
(
  'maximalist_eclectic_collage',
  'Maximalist eclectic collage',
  'maximalist_eclectic_collage',
  'Deliberately ''too much'': clashing patterns, mixed media, dense layering, multiple focal points, saturated colour-blocking. For fashion, festivals, and brands that want energetic abundance rather than restraint.',
  ARRAY['Fashion / streetwear', 'Festivals / events', 'Gen-Z social campaigns', 'Limited drops', 'Music / entertainment'],
  ARRAY['Minimalist / quiet brand voice', 'B2B / enterprise', 'Regulated industries'],
  ARRAY[
    '3+ distinct focal elements competing for attention (intentional, not accidental)',
    'clashing pattern-on-pattern (e.g. polka dot near stripe near floral)',
    'dense layering with little to no negative space',
    'saturated colour-blocking — 4+ strong colours in one frame',
    'mixed media feel (photo + illustration + sticker + type all in one frame)',
    'rotated/overlapping elements at varied angles (nothing axis-aligned)',
    'oversized decorative type mixed with small fine-print-style accents',
    'collectible-sticker or zine aesthetic for small decorative elements'
  ],
  ARRAY[
    'no large empty negative-space areas (density is the point)',
    'no single dominant focal point (must feel multi-focus)',
    'no restrained 2-colour palette (4+ colours required)',
    'no centered template look',
    'no AI-looking perfection (intentional visual chaos, not a tidy grid)'
  ],
  TRUE, TRUE
),
(
  'swiss_international_minimal',
  'Swiss / international typographic minimalism',
  'swiss_international_minimal',
  'Grid-driven, restrained, high-contrast typographic design rooted in the Swiss/International Style: strict baseline grid, sans-serif (Helvetica-like) type, asymmetric but mathematically precise layout, one or two flat colours. For confident, design-forward B2B and editorial brands.',
  ARRAY['Design-forward B2B', 'Architecture / professional services', 'Editorial / publishing', 'Conference / event branding'],
  ARRAY['Playful / youth brands', 'Maximalist or busy compositions', 'Photo-heavy lifestyle content'],
  ARRAY[
    'strict modular grid — every element aligns to a visible column/baseline system',
    'geometric grotesque sans-serif (Helvetica/Akzidenz-like), weight 400-700 only',
    'asymmetric but mathematically precise composition (off-centre, intentional ratios)',
    'flat colour blocks only — one or two colours plus black/white, no gradients',
    'large confident numerals or a single oversized letterform as a graphic element',
    'generous structured whitespace (not empty — organized)',
    'thin rule lines used as grid dividers, not decoration',
    'left-aligned or strict-grid text blocks, never centred body text'
  ],
  ARRAY[
    'no gradients, no glow effects, no drop shadows',
    'no script or decorative typefaces',
    'no centred symmetrical layout (the grid must read as deliberately asymmetric)',
    'no more than 2 colours plus black/white',
    'no photographic clutter (if a photo is used, it is cropped to a grid module)'
  ],
  TRUE, TRUE
),
(
  'gradient_mesh_abstract',
  'Gradient-mesh abstract',
  'gradient_mesh_abstract',
  'Smooth, multi-point colour-mesh gradients forming soft abstract backdrops (the 2025 evolution of ''aurora'' gradients), paired with crisp foreground type or a UI mockup. For SaaS, AI products, and brands wanting a soft-futuristic energy without literal 3D.',
  ARRAY['SaaS / AI products', 'Developer tools', 'Modern B2B', 'App launch announcements', 'Conference / webinar promos'],
  ARRAY['Heritage / traditional brands', 'Photo-real lifestyle content', 'Print-feel campaigns'],
  ARRAY[
    'multi-point mesh gradient background (4+ colour nodes blending smoothly, not 2-colour linear)',
    'soft organic colour transitions — no hard edges within the gradient itself',
    'foreground content (type / UI mockup) on a flat or near-flat card floating above the mesh',
    'fine grain/noise texture overlaid on the gradient to avoid banding (subtle, not visible grain)',
    'one or two saturated ''hero'' colours in the mesh plus darker/lighter supporting tones',
    'soft glow halo behind the foreground card where it meets the gradient',
    'asymmetric placement of the gradient''s brightest point (not centred)',
    'crisp, high-contrast foreground typography against the soft background'
  ],
  ARRAY[
    'no simple 2-stop linear gradient (must be a multi-point mesh, not a basic blend)',
    'no banding artifacts (the grain/noise texture is required to avoid this)',
    'no literal 3D rendering in the background (the mesh is flat/painterly, not a 3D render)',
    'no muted palette (the mesh must read as vivid and current)',
    'no busy foreground competing with the gradient for attention'
  ],
  TRUE, TRUE
),
(
  'organic_blob_botanical',
  'Organic blob / botanical modern',
  'organic_blob_botanical',
  'Soft organic blob shapes, hand-cut botanical/plant motifs, and earthy-but-bright colour palettes — the wellness/clean-beauty aesthetic refreshed for 2025-2026 with more colour confidence. For wellness, clean beauty, and sustainability-forward brands.',
  ARRAY['Wellness / clean beauty', 'Sustainable / eco brands', 'Food & beverage', 'Health products', 'Spa / self-care'],
  ARRAY['Tech / SaaS', 'High-energy youth brands', 'Corporate / finance'],
  ARRAY[
    'soft organic blob shapes (irregular, no straight edges) as background or frame elements',
    'hand-cut or vector botanical motifs (leaves, florals, stems) as supporting decoration',
    'bright-but-earthy palette (terracotta, sage, cream, sunset coral — saturated, not dusty)',
    'product or subject nested inside or overlapping a blob shape',
    'soft natural shadow beneath the hero subject (no studio hard light)',
    'rounded, friendly sans-serif or warm serif headline type',
    'asymmetric organic composition — nothing on a rigid grid',
    'subtle paper or linen texture on the background blob fill'
  ],
  ARRAY[
    'no straight-edged geometric shapes (organic/rounded only)',
    'no cold/clinical colour palette (must read warm and bright)',
    'no glossy/synthetic materials (this is a soft, natural-feeling style)',
    'no dense clutter (generous breathing room around the blob composition)',
    'no AI-looking perfection (slight asymmetry in the botanical line work is wanted)'
  ],
  TRUE, TRUE
),
(
  'kinetic_motion_typography',
  'Kinetic motion-inspired typography',
  'kinetic_motion_typography',
  'Static image that implies motion: type and shapes with directional blur trails, speed-line accents, and dynamic diagonal energy — borrows from kinetic-typography video design. For high-energy launches, sales/urgency campaigns, and sports/fitness brands.',
  ARRAY['Flash sales / urgency offers', 'Sports / fitness', 'Event countdowns', 'High-energy product drops', 'App / game launches'],
  ARRAY['Calm / luxury positioning', 'Long-form informational content', 'Regulated / serious industries'],
  ARRAY[
    'directional motion blur trail behind the headline word or hero object',
    'diagonal compositional energy — primary axis is 15-30 degrees off horizontal',
    'speed-line or streak accents reinforcing the direction of motion',
    'one word or number rendered large with a ''just landed'' offset double-exposure ghost',
    'bold condensed sans-serif headline, weight 800-900, italicised or skewed',
    'high-contrast colour pairing with one ''hot'' accent (orange-red, electric yellow)',
    'fragmented or split-exposure treatment on a secondary element for energy',
    'sharp focal subject against a slightly blurred or streaked background'
  ],
  ARRAY[
    'no static, axis-aligned layout (diagonal energy is mandatory)',
    'no soft/calm colour palette (high contrast and one hot accent required)',
    'no literal video-frame artifacts (this is a single rendered still, not a video screenshot)',
    'no cluttered competing motion directions (one clear direction of energy only)'
  ],
  TRUE, TRUE
)
ON CONFLICT (id) DO NOTHING;
