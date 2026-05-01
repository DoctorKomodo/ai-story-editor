# Tests / E2E

Tier-2 Playwright specs that run against the live `make dev` Docker Compose stack (frontend :3000, backend :4000, postgres :5432). Two specs gate PRs (`smoke.spec.ts`, `full-flow.spec.ts`) and one is developer-run only (`visual.spec.ts`).

## Running the default suite

```bash
make dev          # in one shell — boots compose
make test-e2e     # in another — runs everything except visual.spec.ts
```

The default Playwright config (`playwright.config.ts` at the repo root) `testIgnore`s `visual.spec.ts` so visual regression doesn't gate CI. Smoke + full-flow stay in.

## Running the visual suite

```bash
# In one shell:
make dev

# In another:
npm run test:e2e:visual
```

This uses `playwright.visual.config.ts`, which targets `visual.spec.ts` only and tightens screenshot defaults (`maxDiffPixels: 200`, `animations: 'disabled'`, `caret: 'hide'`). Three tests run — one per theme (`paper`, `sepia`, `dark`) — each capturing seven surface baselines (editor, CharacterSheet, StoryModal, Settings → Venice, AccountPrivacyModal, StoryPicker modal, ModelPicker).

The first run on a fresh checkout has no baselines, so every assertion will fail with a "missing snapshot" message **and** Playwright will write the baselines to disk. Re-run the suite a second time and it should pass.

## Updating baselines

When a token / primitive / modal surface changes intentionally, regenerate the snapshots:

```bash
npx playwright test --config=playwright.visual.config.ts --update-snapshots
```

Inspect the diff (`git diff --stat tests/e2e/__screenshots__/`) before committing; large diffs across all themes usually mean a token cascade landed and is correct, but small diffs in one surface should be eyeballed for accidental regressions.

## Platform pinning

Playwright suffixes snapshot filenames with the OS (e.g. `editor-paper-linux.png`). **Linux is the authoritative platform** for this repo — it matches the Docker container runtime and the eventual CI surface even though visual regression isn't CI-gated today. macOS / Windows runs will produce platform-specific snapshot directories; **do not commit those**. If you only have a non-Linux machine, run the visual suite inside a Linux container or the `make dev` stack itself before committing baselines.

A quick sanity filter for staging:

```bash
git add tests/e2e/__screenshots__/*-linux.png
```

## Why visual isn't in CI

Three themes × seven surfaces × OS-pinned baselines is ~21 PNGs that drift on font-rasterisation, GPU compositor changes, and Chromium minor-version bumps. Until the design stabilises (see `docs/HANDOFF.md` § "Visual regression"), gating PRs on these is more noise than signal. Run it locally before merging changes that touch tokens, primitives, or modal layout — in particular the `<Modal>` primitive, `frontend/src/index.css`, or `tailwind.config.*`.
