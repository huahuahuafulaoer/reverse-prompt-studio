# Reverse-Prompt Output Contract

The reverse-prompt result has one structured source of truth and multiple views. Never write two independent prompts.

## Reverse Prompt Studio transfer contract

The editor transport `reverse-image-prompt/editor-v1` always includes these fixed top-level fields:

```json
{
  "transferMode": "content_fidelity",
  "contentAnchors": {
    "subject": { "value": "", "preserve": true, "sourceRole": "content_reference" },
    "action": { "value": "", "preserve": true, "sourceRole": "content_reference" },
    "interaction": { "value": "", "preserve": true, "sourceRole": "content_reference" },
    "scene": { "value": "", "preserve": true, "sourceRole": "content_reference" }
  }
}
```

Allowed modes are `content_fidelity`, `style_composition`, and `subject_swap`. For content fidelity, every anchor value and the `S`/`A` sections are non-empty, and preserved subject/action semantics stay positive rather than appearing in `omit` or negative constraints. Add two semantic-drift negatives: same-scene activities with a different primary action, and similar-posture/equipment professions, tasks, or uses. For style composition, use empty values with `preserve=false` and `sourceRole=not_applicable`. For subject swap, `contentAnchors.subject.value` exactly matches the user's replacement, with `preserve=true` and `sourceRole=user_or_project_truth`. Preserve this contract during product matching and ordinary revisions. When the user clearly requests a section modification, synchronize its authorized `contentAnchors` keys and all related preserve, translate, and exclusion language; do not leave the prior subject/action/interaction/scene semantics elsewhere in the recipe. Dependency synchronization never overwrites `user_or_project_truth`.

明确的板块修改必须同步对应的 `contentAnchors`，并同步关联的保留、转译和排除内容。

## Mode selection

| User intent | Mode | Return |
|---|---|---|
| “反推 / 拆解这张图” with no format request | `read_mode` | Chinese visual control card only |
| “输出 JSON / 复制提示词” | `json_mode` | One valid semantic JSON object only |
| “按当前方案生成” | `direct_generate_mode` | Use the structured state internally; do not print JSON unless asked |
| “给我证据 / 为什么这样判断” | `audit_mode` | Evidence grid, source-role manifest, confidence, and unknowns |
| Small follow-up edit | `edit_mode` | Change receipt plus affected card sections only |

If the user explicitly asks for two views, provide them. Otherwise do not show the control card and JSON together.

## Internal evidence state

Before rendering any mode, keep an internal record of:

- `reconstruction_status: inferred_recipe_not_original_prompt`;
- source-role manifest with one primary role per input;
- decisive evidence classified as `observed`, `inferred`, `user_or_project_truth`, or `unknown`;
- confidence for estimates;
- `preserve`, `translate`, and `omit` decisions;
- truth gaps and review status.

Do not expose this full record in `read_mode` unless it changes what the user may safely generate. Surface necessary uncertainty through the `Q` section and JSON truth constraints.

## Read mode: Chinese visual control card

Use concise Chinese section titles and stable field IDs. Omit irrelevant sections rather than filling them mechanically.

```text
《视觉控制卡｜[短标题]》

【00｜画面目标】
M01 画面类型：[plain-language value]
M02 核心感觉：[plain-language value]
M03 画幅：[ratio]
M04 画面文字：[generate / composite later / none]

【01｜人物】
S01 人物：[value]
S02 出镜范围：[value]
...

【02｜动作】
A01 核心动作：[value]
...

【03｜产品】
P01 产品：[value]
...

【04｜构图】
C01 景别：[value]
C02 主体位置：[plain language]〔x [0-100]% / y [0-100]%〕
C03 主体占比：[plain language]〔[0-100]%〕
...

【05｜镜头】
K01 视角：[value]
K02 景深：[plain language]〔[1-5]/5〕
...

【06｜光影】
L01 主光方向：[plain language]〔clock or vector value〕
L02 光线软硬：[plain language]〔[1-5]/5〕
...

【07｜色彩】
G01 主体色：[value]
...

【08｜环境与空间】
E01 场景：[value]
...

【09｜材质与成像】
R01 材质重点：[value]
...

【10｜真值与迁移边界】
Q01 参考图职责：[role]
Q02 保留：[value]
Q03 转译：[value]
Q04 不复制：[value]
Q05 待补真值 / 人工复核：[value or none]

【11｜禁止项】
X01 [failure-specific constraint]
...
```

### Control-card rules

- Values must be understandable without knowing photographic jargon.
- Pair qualitative and numeric descriptions when the number improves editing: `偏硬〔4/5〕`, not just `4`.
- Percent coordinates are approximate controls, not claims of pixel measurement. Use origin `top-left = 0,0`.
- Keep IDs stable within the conversation. New fields receive a new ID; removed fields are not silently reused for another meaning.
- Do not include the screenshot frame, app chrome, black bars, captions, or watermarks as visual language unless the user explicitly wants them.
- Put risk where the user can act on it. Do not bury an unverified product structure in a generic disclaimer.

## Edit mode

Accept any of these:

```text
把 S01 改成 30 岁女性越野跑者。
C02.x = 72。
锁定 L*、G*；其他保持不变。
```

Resolve all edits to stable field IDs and the corresponding JSON paths. Preserve unspecified fields.

For small changes, return:

```text
已修改：S01、C02
保持锁定：L*、G*
联动待确认：A01、P04（only when required）

【affected section only】
```

Do not repeat the full card unless the user asks to see it.

### Dependency checks

Check these common relationships:

- subject identity/body visibility → action, wardrobe, crop;
- product category/shape/scale → grip, contact, product orientation, crop;
- action → balance, gaze, hand anatomy, motion treatment;
- aspect ratio/copy area → subject placement, crop, viewing path;
- camera position → perspective, occlusion, product visibility;
- light direction/size → shadow direction, specular shape, material readability;
- material/transparent structure → highlights, refraction, background separation.

When the user clearly requests a section modification, synchronize the minimum necessary unlocked linked fields, authorized `contentAnchors`, and related preserve/translate/exclusion constraints. If a required linked field is locked, return `dependency_conflict` and ask for confirmation. Never override a lock silently.

## JSON mode: semantic generation JSON

Return one valid JSON object with no comments, trailing commas, Markdown explanation, or duplicate prose prompt. Chinese values are allowed. English keys remain stable for portability.

This is a platform-neutral semantic prompt, not a claim that a provider exposes these exact API parameters. It may be pasted as text into a language-aware image generator. When a provider is specified, adapt it through the provider skill while preserving this object as the source of truth.

Use this top-level order and omit irrelevant objects:

```json
{
  "schema": "reverse-image-prompt/v1",
  "task": "",
  "output": {},
  "creative_direction": {},
  "reference_transfer": {},
  "subject": {},
  "action": {},
  "product": {},
  "composition": {},
  "camera": {},
  "lighting": {},
  "color": {},
  "environment": {},
  "rendering": {},
  "typography": {},
  "truth_constraints": {},
  "negative_constraints": [],
  "edit_control": {
    "preserve_unspecified_fields": true,
    "dependency_check": true,
    "single_variable_testing": true
  }
}
```

### Stable field-group mapping

| Card group | JSON object |
|---|---|
| `M` | `task`, `output`, `creative_direction` |
| `S` | `subject` |
| `A` | `action` |
| `P` | `product` |
| `C` | `composition` |
| `K` | `camera` |
| `L` | `lighting` |
| `G` | `color` |
| `E` | `environment` |
| `R` | `rendering` plus relevant material fields |
| `T` | `typography` |
| `Q` | `reference_transfer`, `truth_constraints` |
| `X` | `negative_constraints` |

Do not add a `compiled_prompt` field. It duplicates the structured state and will drift.

## Direct-generate mode

Only enter this mode when the user explicitly asks to generate or edit an image.

1. Validate required truth and unresolved dependency conflicts.
2. Use the relevant image/provider skill.
3. Pass the semantic JSON as prompt text or adapt it internally to verified provider syntax.
4. Do not expose an additional prose prompt unless requested.
5. Preserve generated assets according to the active workspace/project policy.

## Audit mode

Return only the evidence needed for review:

| Dimension | Observation or truth | Evidence class | Confidence | Transfer decision |
|---|---|---|---|---|

Also include the source-role manifest and unresolved truth gaps. Keep the conclusion explicit: the result is an inferred visual recipe, not the recovered original prompt.

## Controlled tests

Use 1–3 tests only when useful. Change one field or tightly coupled field set per test and name the exact IDs/JSON paths that vary. Everything else stays locked.
