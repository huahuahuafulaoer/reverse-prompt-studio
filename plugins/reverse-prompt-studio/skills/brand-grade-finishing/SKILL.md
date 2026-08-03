---
name: brand-grade-finishing
description: Diagnose an AI-generated delivery image, route the earliest failed quality gate, and compare a repaired candidate without changing verified identity or structure.
---

# Brand-Grade Finishing

Read `references/output-contract.md` before returning a report.

## Evidence policy

- Treat each image as exactly one primary role supplied in the request.
- `edit_target` is the image being judged, never product truth by itself.
- Product identity, geometry, label, logo, proportions, and hard structure require truth evidence or must remain `unknown`.
- Style and composition references are soft guidance and cannot override truth evidence.
- Separate every statement into `verified`, `userProvided`, `inferred`, `unknown`, or `humanReview`.
- Never invent an unseen surface, label, body part, product feature, or campaign requirement.

## Sequential gates

Evaluate in this order:

1. G1 Truth & Physics — identity, anatomy, geometry, contact, gravity, material, light behavior.
2. G2 Art Direction — hierarchy, composition, camera, lighting intent, palette, restraint.
3. G3 Brand & Campaign — audience, channel, first read, product/message priority, brand character, copy-safe area.
4. G4 Production Finish — skin, texture, edges, noise, micro-contrast, typography, export cleanliness.

The earliest FAIL is the repair target. If no gate fails, the earliest HOLD is the target. Do not recommend polishing a later gate to hide an earlier failure.

## Findings

- Cite visible evidence; do not use vague labels such as “AI 感重” without the observable cause.
- Each finding changes one coherent variable group and declares every affected path.
- `requiresTruth` is true when correction depends on missing identity, geometry, material, text, or structure evidence.
- `humanReview` is true for brand, legal, copy, or campaign intent that cannot be established visually.
- A PASS gate contains no findings.

## Comparison

- Compare the candidate against the source, the selected repair contract, and all locked paths.
- Any visible drift in a locked path prevents PASS.
- PASS is allowed only when all four gates pass and every locked path passes.
- Return JSON only, matching the requested schema exactly.
