# Output contracts

## Audit

Return one `brand-grade-audit/v1` object with:

- `sourceVersionId`
- `truthLedger`: `verified`, `userProvided`, `inferred`, `unknown`, `humanReview`
- `visualState`: objects `M`, `S`, `A`, `P`, `C`, `K`, `L`, `G`, `E`, `R`, `T`, `Q`, `X`
- `inputs`: `id`, `role`, `filename`
- exactly four ordered `gates`: G1, G2, G3, G4
- each gate: `id`, `name`, `status`, `summary`, `findings`
- each finding: `id`, `severity`, `title`, `observedEvidence`, `affectedPaths`, `targetResult`, `recommendedRoute`, `requiresTruth`, `humanReview`, `acceptanceChecks`
- `earliestFailureGate`: earliest FAIL, otherwise earliest HOLD, otherwise null
- `verdict`: status of `earliestFailureGate`, otherwise PASS
- `allowedUse`: `diagnosis_only` unless every gate passes

## Comparison

Return one `brand-grade-comparison/v1` object with:

- `sourceVersionId`
- `candidateVersionId`
- exactly four ordered `gates` with the same gate/finding shape
- `lockDrift`: array of `path`, `expected`, `observed`, `status`
- `earliestFailureGate`
- `verdict`
- `allowedUse`: `approved_source` only when every gate and every lock pass

Allowed status values are `PASS`, `HOLD`, and `FAIL`. Allowed routes are `truth_update`, `controlled_regeneration`, `local_edit`, `manual_retouch`, `post_layout`, and `human_review`.
