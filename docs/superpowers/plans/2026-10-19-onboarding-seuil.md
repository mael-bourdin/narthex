# Premier lancement « Le seuil » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop form and the question-based `narthex init` with the animated « seuil » first launch: key → prénom → idée → real first look → team → name → Fil.

**Architecture:** Copy, team preview and the first-look contract live in `@narthex/core` so the app and the CLI say the same thing. The engine gains a `firstLook` capability on every runtime, a key check helper, a runtime switch before founding, and `company.found` carries the first look so Margaux's first deliverable and its credits are recorded at founding. The desktop renders the scene in React (CSS + SVG, no animation library); the CLI renders it with ANSI.

**Tech Stack:** TypeScript (erasable syntax only), Node 24, `@anthropic-ai/sdk` 0.135, Electron 44 + React 19, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-19-onboarding-seuil-design.md`. Visual reference: scene A of `.superpowers/brainstorm/*/content/concepts.html` (opening, exact motion) and `seuil-v2.html` (whole sequence).

## Global Constraints

- macOS and Windows first-class; everything the app does must also be doable in `narthex`.
- Never spend without consent: a key saved for Narthex, or `runtime: "anthropic"` in config, is consent; an exported `ANTHROPIC_API_KEY` alone is not, and never pre-fills the key.
- Copy in French, tutoiement, exact strings from the spec (see Task 1), Geist only, no emoji, no capitals spacing.
- Ambiance Braise de minuit: `#1c2353`, `#5b2860`, `#c4607f`, `#f0cfa0`, blend `screen`, animated grain. Logo: Figma « Logo / Symbole » 135:7 paths.
- The key only travels renderer → main (IPC) → `config.json` (mode 0600); never stored in the renderer.
- Nothing is created before step 8 (`company.found`).
- `prefers-reduced-motion`: same steps, short fades instead of movement.

## Review Focus

- A pasted key with surrounding spaces or a trailing newline is accepted (trimmed). → Task 3 test `verifyAnthropicKey trims`.
- Pressing Entrée on an empty line does nothing (no empty prénom, idée or nom). → Task 6 test `ignores empty submit`, Task 7 CLI loop re-asks.
- The first-look call fails or times out (no network, rate limit): Margaux says she couldn't look now and that Léa will, and the flow continues without findings. → Task 3 test `firstLook failure falls back`.
- The app is closed mid-flow: on relaunch it starts over at the seuil, nothing half-created. → Task 6 (App keeps scene until `onDone`; state stays `null`).
- A very long idea (300+ characters) wraps and still rises; the first-look prompt receives it untruncated. → Task 6 visual check step, Task 3 test passes a 400-char idea.

---

### Task 1: Core — onboarding copy, team preview, first-look contract, kickoff by tag

**Files:**
- Create: `packages/core/src/onboarding.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/policy.ts` (KICKOFF condition), `packages/core/src/projection.ts` (task.completed / task.failed only free the agent if it was that agent's current task), `packages/core/src/protocol.ts`
- Test: `packages/core/test/onboarding.test.ts`

**Interfaces:**
- Produces:
  - `interface Finding { text: string; source: string }`
  - `interface FirstLook { reaction: string; findings: Finding[]; simulated: boolean; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; credits: number } }`
  - `function onboardingTeam(): { now: RoleDef[]; later: RoleDef[] }` — `now` = roles hired at stage `research` except `cofondateur`; `later` = roles hired at `creation` and not in `now`; computed by evaluating `HIRING[].when` on a synthetic state, not hard-coded.
  - `const SEUIL` copy object with exactly: `hello: "Bonsoir. Je suis Margaux, ta future co-fondatrice."`, `askKey: "Pour penser, j'ai besoin d'une clé. Colle ta clé API Anthropic."`, `keyAside: "Elle reste sur ton ordinateur. Tu peux la retirer quand tu veux."`, `checking: "Vérification…"`, `badKey: "Cette clé ne marche pas. Vérifie-la et recolle-la."`, `skipKey: "Pas de clé ? Essayer en simulation"`, `askName: "Je t'entends. Comment tu t'appelles ?"`, `askNameNoKey: "Comment tu t'appelles ?"`, `askIdea: (name) => \`Enchantée, ${name}. Raconte-moi ton idée. Une phrase suffit.\``, `searching: "Je regarde ce qui existe déjà…"`, `noLook: "Je n'ai pas pu chercher maintenant. Léa s'en occupera dès son arrivée."`, `team: "Il y a de la place pour toi. Je fais venir l'équipe."`, `later: "Arrivera quand on aura quelque chose à vendre"`, `askCompany: "On l'appelle comment, ta maison ? Même provisoire."`, `welcome: (company) => \`Bienvenue chez ${company}. On commence.\``, `enter: "Entrer"`.
  - `ROLE_PROMISE: Record<RoleId, string>` one line each (e.g. recherche: "Étudie ton marché et tes concurrents", juridique: "Crée ta société, suit tes obligations").
  - Protocol: `"onboarding.firstLook": { params: { idea: string; founderName: string }; result: FirstLook }`; `FoundParams` gains `firstLook?: FirstLook`.
  - `KICKOFF` is planned when the agent has no task with `tag === kickoff.tag` (was: no task at all).

- [ ] **Step 1: Write failing tests** in `onboarding.test.ts`: `onboardingTeam().now.map(r=>r.id)` equals `["recherche","juridique"]`; `.later.map(r=>r.id)` equals `["prospection","redaction"]`; `SEUIL.askIdea("Inès")` equals `"Enchantée, Inès. Raconte-moi ton idée. Une phrase suffit."`; projection test: agent working on `t1`, completing unrelated `t2` keeps `status: "working"` and `currentTaskId: "t1"`; policy test: an agent whose only task is a done `first-look` still gets its kickoff planned.
- [ ] **Step 2:** `npx vitest run packages/core` → FAIL (module missing).
- [ ] **Step 3:** Implement as specified above.
- [ ] **Step 4:** `npx vitest run packages/core && npx tsc -p packages/core` → PASS.
- [ ] **Step 5:** Commit `Premier lancement : textes, équipe d'accueil et contrat du premier coup d'œil`.

### Task 2: Engine — config consent, key check, runtime switch

**Files:**
- Modify: `packages/engine/src/config.ts`, `packages/engine/src/engine.ts`
- Create: `packages/engine/src/keys.ts`
- Test: `packages/engine/test/config.test.ts`, `packages/engine/test/keys.test.ts`

**Interfaces:**
- Produces:
  - `needsKey(config: Config): boolean` — true unless `config.anthropicApiKey` or `config.runtime` is `"anthropic"` or `"simulation"`.
  - `verifyAnthropicKey(key: string, client?: Pick<Anthropic, "models">): Promise<{ ok: true; key: string } | { ok: false; message: string }>` — trims, rejects if not starting with `sk-ant-` (message `SEUIL.badKey`), calls `models.list({ limit: 1 })`; `Anthropic.AuthenticationError`/`PermissionDeniedError` → `SEUIL.badKey`; `Anthropic.APIConnectionError` → `"Je n'arrive pas à joindre Anthropic. Vérifie ta connexion et recolle la clé."`.
  - `saveKey(dir: string, key: string): Config` — saves `anthropicApiKey` and deletes `runtime` (auto ⇒ anthropic).
  - `chooseSimulation(dir: string): Config` — saves `runtime: "simulation"`.
  - `Engine.switchRuntime(runtime: AgentRuntime, clock: Clock): void` — throws `"L'entreprise existe déjà : relance Narthex pour changer de mode."` if a company exists.

- [ ] **Step 1: Failing tests:** `needsKey({})===true`, `needsKey({runtime:"simulation"})===false`, `needsKey({anthropicApiKey:"sk-ant-x"})===false`; `verifyAnthropicKey("  sk-ant-abc\n", fake)` resolves `{ok:true,key:"sk-ant-abc"}` and the fake saw one `list` call (test name `verifyAnthropicKey trims`); fake throwing `new Anthropic.AuthenticationError(401, …)` → `{ok:false, message: SEUIL.badKey}`; `"hello"` → not ok without calling the client; `switchRuntime` after `company.found` throws; before it, `status().runtime` reflects the new runtime.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Construct SDK errors in tests from the classes the SDK exports (`Anthropic.AuthenticationError`); if the constructor shape differs, use `Object.create(Anthropic.AuthenticationError.prototype)`.
- [ ] **Step 4:** `npx vitest run packages/engine && npx tsc -p packages/engine` → PASS.
- [ ] **Step 5:** Commit `Moteur : clé vérifiée, consentement explicite, bascule de runtime avant fondation`.

### Task 3: Engine — first look on both runtimes, founding with first look

**Files:**
- Modify: `packages/engine/src/runtime.ts`, `simulation.ts`, `anthropic.ts`, `engine.ts`
- Test: `packages/engine/test/firstlook.test.ts`

**Interfaces:**
- Consumes: `FirstLook`, `Finding`, `FoundParams.firstLook` (Task 1).
- Produces:
  - `AgentRuntime.firstLook(input: { idea: string; founderName: string; now: number; signal: AbortSignal }): Promise<FirstLook>`
  - Engine handles `"onboarding.firstLook"` with a 45 s timeout; any error or timeout returns `{ reaction: SEUIL.noLook, findings: [], simulated: <runtime is simulation> }` (never throws).
  - `found(p)`: after `company.founded`, hires `cofondateur` directly (same post as today), then if `p.firstLook` has findings: emits `task.planned` + `task.completed` for Margaux with tag `first-look`, title `"Premier coup d'œil sur le marché"`, a deliverable whose body is a Markdown list `- {text} ({source})` and whose `sources` are the finding sources, a `post.published` of kind `deliverable` with text = `reaction`, and `usage.recorded` if `usage` is present. Then `tick()`.
- Anthropic `firstLook`: one `client.beta.messages.create` (non-streaming, `max_tokens: 4000`) with `web_search_20260209` (`max_uses: 4`), `output_config: { effort: "low", format: { type: "json_schema", schema } }`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`; schema `{reaction: string, findings: [{text, source}] (3–5)}`; reaction instruction: one short warm sentence in French reacting to the idea, then « Je regarde ce qui existe déjà… » is NOT included (the UI shows it before). Parse with `JSON.parse` of the last text block; validate shape; usage → credits with the existing `addUsage`.
- Simulation `firstLook`: reaction `"J'aime beaucoup l'idée."`, 4 generic findings whose `source` ends with `" (exemple)"`, `simulated: true`, no usage.

- [ ] **Step 1: Failing tests:** simulation `onboarding.firstLook` returns 4 findings all ending `(exemple)`; `firstLook failure falls back` (runtime whose `firstLook` rejects → result `reaction === SEUIL.noLook`, `findings` empty); found with a first look → one deliverable tagged `first-look` by Margaux, `usage.credits` equals the given credits, `company.stage` is `"research"` after `settle`, and a task tagged `market-study` exists for Léa; found with a 400-char idea passes it untruncated to `firstLook` (spy).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `Premier coup d'œil réel ou simulé, enregistré à la fondation`.

### Task 4: Desktop main + preload — onboarding bridge

**Files:**
- Modify: `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: `needsKey`, `verifyAnthropicKey`, `saveKey`, `chooseSimulation`, `Engine.switchRuntime`, `AnthropicRuntime`, `systemClock`, `loadConfig` (Task 2).
- Produces on `window.narthex.onboarding`:
  - `needsKey(): Promise<boolean>`
  - `submitKey(key: string): Promise<{ ok: true } | { ok: false; message: string }>` — verify, `saveKey`, and if the app owns the engine and there is no company, `switchRuntime(new AnthropicRuntime({ apiKey, model }), systemClock)`.
  - `useSimulation(): Promise<void>` — `chooseSimulation(dir)`.
- IPC channels `narthex:onboarding:needsKey|submitKey|useSimulation`.

- [ ] **Step 1:** Implement; `npx tsc -p apps/desktop` → PASS.
- [ ] **Step 2:** Commit `App : pont d'accueil (clé, simulation)`.

### Task 5: Desktop scene building blocks

**Files:**
- Create in `apps/desktop/src/renderer/src/seuil/`: `Ambiance.tsx`, `Door.tsx`, `Speech.tsx`, `TypeLine.tsx`, `Findings.tsx`, `TeamReveal.tsx`, `seuil.css`

**Interfaces:**
- Produces:
  - `<Ambiance phase="hidden" | "on" | "awake" | "calm" />` — blobs + grain + `awake` triggers the centre light burst once.
  - `<Door state="drawing" | "through" | "small" />` — Figma 135:7 paths; drawing = thin stroke drawn ~1.8 s, light rises inside, then `through` = scale ×16 + fade over 1.6 s (match concepts.html scene A).
  - `<Speech text={string} aside?={string} raised?={boolean} onDone?={() => void} />` — word by word, each word from 8 px blur in 0.5 s, `margin-right: .26em` per word (no collapsed spaces), +260 ms after `. ? …`.
  - `<TypeLine masked?={boolean} onSubmit={(value: string) => void} />` — hidden `<input>` keeps focus and captures paste; renders typed text + caret; masked shows first 11 chars then `•`; on Entrée with trimmed non-empty value, words rise and dissolve (1.7 s) then calls `onSubmit`; empty Entrée does nothing.
  - `<Findings items={Finding[]} />` — one line every 1.1 s, source in `--text-secondary` beside the text.
  - `<TeamReveal now={RoleDef[]} later={RoleDef[]} />` — breathing light per member (per-role colour), name, title, `ROLE_PROMISE`, `later` dimmed with `SEUIL.later`, 1.3 s apart.
  - All motion disabled to short opacity fades under `@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 1:** Implement; `npm run build -w @narthex/desktop` → builds.
- [ ] **Step 2:** Commit `App : briques de la scène du seuil`.

### Task 6: Desktop scene orchestration and App wiring

**Files:**
- Create: `apps/desktop/src/renderer/src/seuil/Seuil.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`; Delete: `apps/desktop/src/renderer/src/Onboarding.tsx`

**Interfaces:**
- Consumes: Tasks 1, 4, 5; protocol `onboarding.firstLook`, `company.found` with `firstLook`.
- Produces: `<Seuil onDone={() => void} />`; steps `seuil → key? → name → idea → look → team → company → welcome`. `key` is skipped when `needsKey()` is false (then Margaux says `hello` then `askNameNoKey`). `look` starts `onboarding.firstLook` as soon as the idea is submitted, shows `searching` while waiting, then `reaction` and the findings (or `noLook`). `company.found` is called on the company name submit, with `firstLook`. « Entrer » calls `onDone`.
- `App`: if the first `state.get` returned `null`, render `<Seuil>` until `onDone`, even after the company exists.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Visual check** with `NARTHEX_HOME=$(mktemp -d) NARTHEX_RUNTIME=simulation NARTHEX_SNAPSHOT=… npx electron apps/desktop` at 3 s (door), 8 s (key step), and drive the flow with `executeJavaScript` typing into the focused input (prénom, a 300-character idée, nom) to capture team and welcome; compare against `seuil-v2.html` captures. Expected: no collapsed spaces, long idea wraps, Entrer leads to the Fil with Margaux's first-look post.
- [ ] **Step 3:** Commit `App : premier lancement « le seuil »`.

### Task 7: CLI — `narthex init` as the seuil

**Files:**
- Create: `apps/cli/src/seuil.ts`
- Modify: `apps/cli/src/bin.ts` (init delegates to `seuil.ts`), `apps/cli/src/style.ts` (add `streamWords(text: string, out: NodeJS.WriteStream): Promise<void>`)
- Test: `apps/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `runSeuil(options: { dir: string; interactive: boolean; given: { idee?: string; prenom?: string; nom?: string } }): Promise<void>`.
- Interactive (TTY and colour): small door logo (3 lines, box-drawing characters), each Margaux line via `streamWords` (word written dim, then rewritten normal after 40 ms), key via masked input (first 11 chars then `•`), empty answers re-asked, findings and team printed one per line with 300 ms gaps, same `SEUIL` copy, then `lancer()` unless `--sans-lancer`.
- Non-interactive or `NO_COLOR`: same steps as plain lines, no delays; missing answers come from `--prenom/--idee/--nom`, else error as today; no key ⇒ simulation.

- [ ] **Step 1: Failing test:** non-TTY `init` output contains `SEUIL.team` and the name of every `onboardingTeam().now` role, and the company has a `first-look` deliverable whose sources end with `(exemple)`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test && npm run typecheck` → PASS; also run interactively once in a real terminal (`NARTHEX_HOME=$(mktemp -d) NARTHEX_RUNTIME=simulation npm run narthex -- init`).
- [ ] **Step 5:** Commit `CLI : narthex init devient le seuil`.

### Task 8: Docs and push

**Files:** `docs/PROMPT.md` (roadmap line « Premier lancement : le seuil » checked), `README.md` (init description), Figma page « Narthex — Parcours » note that « Premier lancement » pixel art is replaced (no Figma redesign in this plan).

- [ ] **Step 1:** Update docs; `npm run typecheck && npm test` → PASS.
- [ ] **Step 2:** Commit and push; CI green on macOS, Windows, Linux.
