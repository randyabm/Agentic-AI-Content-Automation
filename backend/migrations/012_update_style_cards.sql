-- Migration 012: Enrich the 6 default style cards with the visual_cues and
-- negative_constraints derived from the example-image feedback (June 2026).
-- The bold_typographic family in particular now spells out the SaaS-product-
-- marketing look: split layout, ONE emphasis word in contrasting brand
-- colour, glowing orbs, laptop+phone mockup, feature-chip footer. The
-- old "no embedded text / no body copy" constraints are removed so the
-- Visual Agent can render copy directly in the image (the target look,
-- per the user feedback).
--
-- Idempotent: re-applying this migration is a no-op because the UPDATE
-- sets the same value. The WHERE clause matches on id, which is the
-- primary key.

BEGIN;

UPDATE style_cards SET
    description = 'SaaS-product-marketing style: oversized typographic headline with ONE emphasis word in a contrasting brand colour, split or centred layout, soft gradient background, 1-2 glowing orb accents, laptop and/or phone mockup showing the actual product UI, brand logo top-left, footer with feature chips. The image IS the final asset — copy is rendered inside it.',
    best_for = ARRAY['SaaS product launches', 'Punchy offers', 'Hero ads', 'Awareness campaigns', 'Event announcements'],
    not_for = ARRAY['Long body copy', 'Lifestyle storytelling', 'Quiet brand voice'],
    visual_cues = ARRAY[
        'split layout (text on the left third, product mockup on the right two-thirds)',
        'oversized geometric sans-serif headline, weight 800, with ONE emphasis word in a contrasting brand colour at weight 700',
        'italic quote in weight 400 below the headline',
        'regular body copy in weight 400, brand colour',
        'soft diagonal gradient background (white/cream top-left to brand-accent bottom-right)',
        '1-2 glowing orb accents in brand colours (cyan + magenta typical), soft blur, placed as decoration NOT centre',
        'laptop and/or phone mockup showing the actual product UI (sidebar, dashboard, metrics, modals)',
        'brand logo top-left, optional badge top-right, footer row of 4 feature chips (icon + label)',
        'clear typographic hierarchy: headline > quote > body > chips'
    ],
    negative_constraints = ARRAY[
        'no centered template look (off-centre is the goal)',
        'no generic gradient blob (the gradient must support a focal point, not just wash the canvas)',
        'no repeated icon grid (the footer chips are 4 distinct, not a uniform 8-up)',
        'no stock-photo composition (must look AI-crafted, not a Shutterstock image)',
        'no AI-looking perfection (imperfect is fine, sterile is not)',
        'no flat illustration (this is a real-render style with depth and shadow)'
    ]
WHERE id = 'bold_typographic';

UPDATE style_cards SET
    visual_cues = ARRAY[
        'natural lighting, golden hour or soft window light',
        'slight grain or phone-camera texture (NOT clean studio)',
        'real environment, not a studio backdrop',
        'subject candid, mid-action, not posed for the camera',
        'muted, lived-in colour palette',
        'single subject in the frame, not a collage',
        'subtle hand-written or chalkboard text if copy is included'
    ],
    negative_constraints = ARRAY[
        'no studio polish',
        'no overly posed models',
        'no AI-looking perfection (slight asymmetry, natural skin, real lighting)',
        'no flat illustration'
    ]
WHERE id = 'lifestyle_ugc';

UPDATE style_cards SET
    visual_cues = ARRAY[
        'cut-paper or torn-edge textures',
        'layered product cut-outs with soft drop shadows',
        'asymmetric grid with intentional empty space',
        'mixed type scale (one headline large, others small body)',
        'warm neutrals with one strong accent colour',
        'sticker-like decorative elements',
        'polaroid or magazine-clipping framing'
    ],
    negative_constraints = ARRAY[
        'no centered template look',
        'no repeated icon grid',
        'no flat illustration (cut-outs must have texture and shadow)',
        'no AI-looking perfection (collage is meant to be handmade-feeling)'
    ]
WHERE id = 'editorial_collage';

UPDATE style_cards SET
    visual_cues = ARRAY[
        'single hero object, off-centre or floating',
        'studio lighting with rim light and soft key',
        'soft shadow + reflective surface beneath the hero',
        'depth of field with bokeh background',
        'high-fidelity material rendering (metal, glass, plastic, fabric)',
        'dark or gradient studio backdrop',
        'optional floating UI elements / particles around the hero'
    ],
    negative_constraints = ARRAY[
        'no flat illustration (this is the polar opposite — depth required)',
        'no more than one hero subject',
        'no cluttered background (bokeh only, no competing elements)'
    ]
WHERE id = '3d_product_hero';

UPDATE style_cards SET
    visual_cues = ARRAY[
        'scribbles and marker textures',
        'uneven, hand-drawn shapes',
        'playful grid with intentional roughness',
        'warm, paper-like background',
        'muted earth-tone palette',
        'doodle-like icons and arrows',
        'hand-lettered headlines (real hand-lettering feel, not fonts)'
    ],
    negative_constraints = ARRAY[
        'no luxury aesthetic',
        'no clean lines (the imperfection IS the style)',
        'no corporate stock-photo polish',
        'no AI-looking perfection (asymmetry is the point)'
    ]
WHERE id = 'imperfect_hand_drawn';

UPDATE style_cards SET
    visual_cues = ARRAY[
        'unexpected scale (oversized props, miniature subjects)',
        'dreamlike gradient sky or backdrop (saturated, painterly)',
        'cinematic colour grade (teal-and-orange, pastel bloom, etc.)',
        'soft, golden-hour lighting with strong rim',
        'subject in mid-air or mid-moment (floating, leaping, twirling)',
        'seasonal motifs as background props (snow, blossoms, lanterns, fireworks)'
    ],
    negative_constraints = ARRAY[
        'no regulated or serious tone',
        'no flat illustration (this style demands depth and atmosphere)',
        'no stock-photo composition (must feel hand-crafted, dreamlike)'
    ]
WHERE id = 'surreal_seasonal_scene';

COMMIT;
