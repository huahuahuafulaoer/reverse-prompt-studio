# Finish-only realism and brand method

Research date: 2026-08-03.

## Product conclusion

An approved master should not be regenerated from a clay pass or redesigned. The finish-only prompt has two independent jobs:

1. Restore photographic coherence from visible evidence in the source.
2. Translate an optional user-provided brand direction into bounded finishing controls.

Photographic coherence is evaluated as five connected systems: lighting coherence, material response, skin realism, depth and optics, and image finish. Brand direction may affect tone curve, color balance, light quality, contrast, saturation, and surface finish only. It cannot change content, composition, geometry, identity, products, text, or logos.

## Evidence

- OpenAI recommends short, explicit edit instructions that state both what changes and what remains fixed, with small targeted revisions rather than broad reactions: https://openai.com/academy/image-generation/
- Google Imagen documentation treats photography as subject/context/style plus concrete photographic modifiers; this supports precise light and framing language, not relying on generic quality words alone: https://cloud.google.com/vertex-ai/generative-ai/docs/image/img-gen-prompt-guide
- Adobe documents composition reference as outline and depth control and exposes lighting/color/camera controls separately. This supports keeping composition locked while finishing appearance: https://helpx.adobe.com/firefly/web/work-with-images/generate-images/match-image-composition-to-reference-image.html
- A large human study of diffusion-image photorealism reports that artifact type, scene complexity, curation, and viewing conditions affect detection. The project paper specifically discusses soft/plastic skin, lighting inconsistency, and local artifacts: https://arxiv.org/abs/2502.11989
- Practitioner discussions repeatedly warn that adding pores, camera models, and “ultra detail” can still produce plastic, bump-mapped skin when texture does not react to light: https://www.reddit.com/r/midjourney/comments/1oa7jsj/the_prompt_i_use_to_generate_extremely_realistic/
- Professional-retouching discussions converge on selective local work—dodge and burn, healing, controlled frequency separation, local color, and final grain—while warning that global smoothing and careless frequency separation create plastic skin: https://www.reddit.com/r/photoshop/comments/18lbwjb/anyone_know_how_to_do_this_skin_retouching/
- Commercial AI campaign case studies describe the final step as light consistency, texture realism, color correction, typography/layout control, and human art direction rather than one-click regeneration: https://www.behance.net/gallery/244870363/Hybrid-AI-Generation-Creative-Refinement

## Counter-evidence and limits

- Community prompt recipes are platform- and model-dependent and often show only selected successful images. Treat them as practice signals, not universal facts.
- A text-only brand direction cannot prove brand consistency. It can only guide tonal expression. True brand consistency needs brand-owned references or a visual system.
- A finishing prompt cannot repair wrong anatomy, product geometry, contact physics, text, or missing structure without leaving finish-only scope. Such sources must return upstream.
- Adding synthetic grain, lens defects, pores, or JPEG damage is not automatically more photographic. These cues are allowed only when they unify an already plausible imaging system.
