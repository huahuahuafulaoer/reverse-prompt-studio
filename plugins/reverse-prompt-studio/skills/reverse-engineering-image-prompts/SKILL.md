---
name: reverse-engineering-image-prompts
description: Use when a user supplies one or more reference images and asks to reverse-engineer, extract, infer, recreate, transfer, or adapt the visual prompt, composition, lighting, art direction, photography, rendering, or style—especially for product, e-commerce, campaign, lifestyle, poster, 3D, illustration, typography, landscape, or character images.
---

# Reverse-Engineering Image Prompts

## Core principle

Reconstruct a **plausible causal visual recipe**, not the unknown original prompt. Convert visible evidence into transferable instructions while separating observation, inference, verified truth, and unknowns.

## Non-negotiable boundaries

- Inspect every target image directly. Do not reverse-prompt from a filename, memory, alt text, or another person's summary when the image is available.
- State that the result is an inferred recipe, never a verified recovery of the original prompt.
- Separate four evidence classes: `observed`, `inferred`, `user_or_project_truth`, and `unknown`.
- Assign each input exactly one **primary** role: `edit_target`, `product_truth`, `subject_reference`, `style_reference`, `composition_reference`, `material_reference`, `hard_structure_reference`, or `inspiration_only`. Never concatenate roles such as `style_reference + composition_reference`. If one image supplies several loose visual cues, use `inspiration_only` and list the permitted cue dimensions.
- Treat `inspiration_only` as analysis evidence. Do not pass it to a generator or copy its distinctive subject combination, location, props, text, brand, or narrative device.
- Never infer exact product geometry, engineering function, performance claim, brand identity, or material specification from appearance alone. Require a verified truth source or mark it unknown. Describe an unverified metaphor as a visible relation—such as “light paths converge toward the corner”—not as a functional verb such as “absorbs impact”, “cools”, “filters”, or “protects”.
- Build a platform-neutral brief first. Adapt syntax only when the provider/model is known.
- Do not generate or edit an image unless the user also asks for execution. Route actual generation to the relevant image-generation skill.

## Workflow

### 1. Resolve the transfer job

Identify what the user wants to reuse:

- `style_transfer`: light, color, atmosphere, material response, finish;
- `composition_transfer`: framing, scale, depth, negative space, viewing path;
- `subject_or_product_swap`: keep visual language while replacing identity-bearing content;
- `scene_transfer`: keep subject/product truth while rebuilding the world;
- `near_recreation`: reproduce most visible relationships, subject to rights and truth boundaries;
- `analysis_only`: explain how the image works without writing a production prompt.

If unspecified, default to `style_transfer + composition_transfer` and replace identity-bearing content. Ask one question only when a different choice would materially change the output.

### 2. Audit sources and roles

For each image, record path/source, dimensions when available, one primary role, what it may control, and what it must not control. Product truth outranks style language; hard structure outranks loose composition language; the user's latest instruction outranks stored defaults.

### 3. Decode visible evidence

Analyze only the dimensions that materially shape the image:

1. communication job and first read;
2. subject identity, state, action, and interaction;
3. frame ratio, crop, subject scale/position, axes, balance, negative space, and viewing path;
4. foreground/midground/background, occlusion, atmosphere, and depth transitions;
5. camera height, view direction, distance, perspective behavior, and depth of field;
6. light source direction, apparent size/softness, falloff, shadow logic, edge light, specular shape, and dark-area readability;
7. dominant color areas, saturation, value structure, contrast, accent hierarchy, and color contamination;
8. surface response, transparency, roughness, thickness, contact, gravity, support, and physical plausibility;
9. environment, props, styling, human behavior, localization, and life evidence;
10. medium/capture behavior, texture, retouching, rendering, typography, and finish.

Use confidence labels. Treat percentages and camera estimates as approximate inference unless measured. Do not name a lens, render engine, lighting modifier, material, weather condition, or production technique as fact unless visible evidence supports it.

After identifying the image type, read [type-modules.md](references/type-modules.md) and load only the matching module(s).

### 4. Build the transfer contract

Write three short lists:

- `preserve`: variables essential to the reference's visual effect;
- `translate`: relationships to rebuild with the new subject/product rather than copy literally;
- `omit`: identity-bearing, legally sensitive, unverifiable, distracting, or user-rejected elements.

Convert adjectives into evidence. Replace “premium” with visible consequences such as controlled highlight width, readable dark values, restrained accent area, stable geometry, and deliberate negative space.

### 5. Pass the art-direction gate

Before writing the prompt, verify:

- one primary visual job and one clear focal hierarchy;
- coherent perspective, light, shadow, depth, scale, gravity, contact, and occlusion;
- a deliberate color-area hierarchy and restrained accent logic;
- believable material response without toy gloss, dead transparency, or invented detail;
- credible human action and product use when relevant;
- sufficient crop/copy safety for the intended channel;
- no unsupported claim, logo, text, product structure, or engineering behavior;
- no prompt overload after the decisive relationships are already clear.

If a blocker cannot be solved from the image, mark `needs_truth` or `human_review`; do not hide it with stylistic language.

### 6. Build one structured source of truth

Store the inferred recipe as structured fields, not as a prose prompt. Use stable semantic groups:

- `M`: communication job and output;
- `S`: subject/person;
- `A`: action and interaction;
- `P`: product/object;
- `C`: composition;
- `K`: camera/capture;
- `L`: lighting;
- `G`: color;
- `E`: environment and depth;
- `R`: rendering, material, and finish;
- `T`: typography/copy handling;
- `Q`: reference transfer, truth gaps, and review status;
- `X`: failure-specific constraints.

Keep field IDs stable during an editing session. Do not renumber unaffected fields after a revision. Express user-facing values as plain language plus a machine-readable value when useful, for example `偏硬〔4/5〕`, `中央偏右〔x 62% / y 58%〕`, or `主体约占 68%`.

The structured state is the only source of truth. Do not maintain a separate prose prompt that can drift from it.

### 7. Present, edit, or execute

Follow the mode contract in [output-contract.md](references/output-contract.md):

- default `read_mode`: show a Chinese visual control card;
- `json_mode`: return one clean semantic JSON object and no duplicate prose prompt;
- `direct_generate_mode`: adapt the structured state through the relevant provider/image skill and generate only when the user explicitly asks;
- `audit_mode`: expose evidence classes, source roles, and confidence only when requested or when risk requires it.

Accept edits by field ID, JSON path, or natural language. Map all three to the same structured state. For a small edit, return a change receipt and only the affected control-card sections unless the user asks to see the full card.

Respect locks. Preserve every unspecified field by default. Before applying a change, check dependencies among subject, action, product, composition, camera, light, and material. If a locked field must change for physical plausibility, stop and request confirmation instead of silently rewriting it.

When a provider is known, adapt syntax and reference handling without changing the structured source of truth. Avoid prestige filler such as `masterpiece`, `award-winning`, `8K`, camera brands, or “Apple-style” unless the user requests it or it expresses necessary visible behavior. Keep constraints short and failure-specific.

Provide at most three controlled tests. Keep the structured core fixed and change one principal variable per test, such as crop, subject scale, light direction, or atmosphere density. Do not call one result a reusable law.

## Output

Read and follow [output-contract.md](references/output-contract.md). Keep the user-facing response concise by default, but preserve the evidence/truth distinctions and unknowns.

## Common mistakes

| Mistake | Correction |
|---|---|
| Describing objects without explaining why the image works | Prioritize hierarchy, spatial relations, light, color areas, and material response. |
| Copying the whole reference while claiming “style transfer” | Use the preserve/translate/omit contract. |
| Treating visible form as engineering proof | Require product truth or mark `unknown`. |
| Guessing lens, engine, or modifiers with certainty | Label bounded inference and confidence. |
| Adding more adjectives when output feels vague | Replace each adjective with visible evidence. |
| Long generic negative prompt | Keep only observed or likely failure boundaries. |
| Mixing multiple prompt variants | Hold the core constant and change one main variable. |
| Returning a long prose prompt that is hard to edit | Make the Chinese visual control card the default human interface. |
| Returning JSON as the default reading experience | Keep JSON as the on-demand machine layer. |
| Maintaining a control card and a separate prose prompt | Use one structured state rendered into different views; never duplicate the source of truth. |
| Silently changing linked fields | Show dependency warnings and respect locks before applying linked changes. |
