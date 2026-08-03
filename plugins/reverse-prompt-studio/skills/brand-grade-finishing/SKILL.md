---
name: brand-grade-finishing
description: Analyze an approved final image for finish-only texture, light, tone, and production-quality improvements without changing its content or structure.
---

# Brand-Grade Finishing

Follow the output schema requested by the turn. `finish-only-plan/v2` is the default product flow. The older audit and comparison schemas remain available only for stored-run compatibility and use `references/output-contract.md`. The evidence and product rationale for the finish-only method are summarized in `references/finish-only-method.md`.

## Default: finish-only plan

- Treat the input as an approved, semantically complete master. The subject, story, art direction, layout, and scene are already decided.
- Never propose changes to identity, face, body, pose, product, equipment, text, logo, crop, camera, composition, geometry, scene structure, or object placement.
- Analyze production finish through five photographic systems: lighting coherence, material response, skin realism, depth and optics, and image finish.
- Return `finish-only-plan/v2` with one short assessment, 1-4 evidence-based realism priorities, and one brand-direction translation. Do not write the final platform prompt; the Studio compiles immutable locks into it.
- Name observable evidence instead of saying only “AI-looking” or “low quality.”
- Keep the plan short. Do not request a new composition, a white/clay reconstruction, hard-structure rerendering, or a new visual concept.

## Brand direction

- Brand direction is user truth, not something to infer from a single image. When the user supplies it, use `user_direction`; otherwise use `preserve_existing` and do not invent premium, cinematic, luxury, editorial, or another style.
- Translate brand direction only into controls available at this stage: tone curve, color balance, light quality, contrast, saturation, and surface finish.
- Do not turn brand direction into a global filter. Keep skin, products, materials, and the environment in one optical world while preserving material-specific response.

## Finish quality rules

- Preserve macro form first, then meso structure such as folds, seams, pores, strata, and contact transitions. Micro detail appears only where focus, distance, light, and material justify it.
- Skin keeps local pores, tonal variation, natural transitions, and facial specificity. Do not recommend global smoothing, global sharpening, HDR, uniform high-frequency texture, or cosmetic replacement.
- Different materials keep distinct frequency, reflectance, roughness, and edge behavior. Texture must never replace form or appear as repeated worm, fingerprint, sandpaper, or etched patterns.
- Highlights reveal existing material; shadows retain layers. Subject and environment must share one believable optical world.
- Prefer selective local contrast and a detail-density gradient over globally stronger contrast, clarity, or sharpness.
- Lighting coherence comes before decorative texture: keep one plausible direction, softness, falloff, highlight rolloff, shadow depth, and contact-shadow logic.
- Depth and optics must stay consistent with the source: preserve the existing focus plane and let acuity, microcontrast, noise, and grain fall off naturally instead of sharpening every plane.
- Image finish is the final normalization pass: remove halos, repeated texture, clipped color, mismatched noise, and synthetic polish without adding fake camera defects.
- Do not treat camera names, film-stock names, `8K`, `masterpiece`, `ultra detailed`, or long negative lists as evidence of photographic realism.

## Legacy audit and comparison

### Evidence policy

- Treat each image as exactly one primary role supplied in the request.
- `edit_target` is the image being judged, never product truth by itself.
- Product identity, geometry, label, logo, proportions, and hard structure require truth evidence or must remain `unknown`.
- Style and composition references are soft guidance and cannot override truth evidence.
- Separate every statement into `verified`, `userProvided`, `inferred`, `unknown`, or `humanReview`.
- Never invent an unseen surface, label, body part, product feature, or campaign requirement.

### Sequential gates

Evaluate in this order:

1. G1 Truth & Physics — identity, anatomy, geometry, contact, gravity, material, light behavior.
2. G2 Art Direction — hierarchy, composition, camera, lighting intent, palette, restraint.
3. G3 Brand & Campaign — audience, channel, first read, product/message priority, brand character, copy-safe area.
4. G4 Production Finish — skin, texture, edges, noise, micro-contrast, typography, export cleanliness.

The earliest FAIL is the repair target. If no gate fails, the earliest HOLD is the target. Do not recommend polishing a later gate to hide an earlier failure.

### Findings

- Cite visible evidence; do not use vague labels such as “AI 感重” without the observable cause.
- Each finding changes one coherent variable group and declares every affected path.
- `requiresTruth` is true when correction depends on missing identity, geometry, material, text, or structure evidence.
- `humanReview` is true for brand, legal, copy, or campaign intent that cannot be established visually.
- A PASS gate contains no findings.

### Comparison

- Compare the candidate against the source, the selected repair contract, and all locked paths.
- Any visible drift in a locked path prevents PASS.
- PASS is allowed only when all four gates pass and every locked path passes.
- Return JSON only, matching the requested schema exactly.
