# 家具を選んで使う Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生活行動で自動／家具指定を選び、行き先と移動・利用の時間、使えない理由を確認して、その家具を実際に使う。

**Architecture:** 既存の `planHousing` に家具IDによる候補制限と予告情報を加える。指示用 `home-use` は保存前に既存 `need` 作業へ変換し、従来の予約・移動・効果・保存を共用する。Reactの選択欄は未確定の画面状態として扱う。

**Tech Stack:** TypeScript 5.9.3、既存React、Node test / tsx、既存Playwright。依存更新なし。

**Spec:** `docs/superpowers/specs/2026-11-24-housing-room-use-design.md`

## Global Constraints

- 画面の選択・予告・指示予約では時計を進めない。移動・待機・実利用は既存の共通時計で計上する。
- Game version 1、Library version 2、保存キーv2、書出しenvelope 1/2、Housing version 1を維持する。originと旧保存、外見10項目41値を保持する。
- 新しい依存、部屋名による性能効果、家具の費用・利用時間の変更、私物割当、倉庫容量、工房専用生産、招待・承諾は今回含めない。
- PCと320/390pxの表示で理由と操作が読めること。現行の日本語・4タブ・人物作成の選択肢を保つ。
- GitHub mainとNotionに実装・検証・次の問いを保存する。Sites本番は更新しない。

## Review Focus

- 別の家具には空きがあるが指定家具だけ予約済み：黙って代替せず、無効な指示でも元の作業・備蓄を保つ（Task 1）。
- 複数席、同名家具、任意の有効ID：名称やIDの分割に依存せず、指定家具の空席を確保する（Task 1）。
- 重傷時のneed許可・危険時の禁止・移動区間途中・旧方式と外出中：新しい入口で既存の条件を迂回しない（Task 1）。
- 表示後に予約や間取りが変化：現在の条件で再検証し、消えた選択や予約不可を別家具へ変換しない（Task 2）。
- 人物・保存枠の切替と再読込み：未確定選択の持越しを防ぎ、確定済みの予約とoriginを保存する（両Task）。

---

### Task 1: 家具を指定する指示と共通の予告

**Files:**
- Modify: `src/reform/housing/types.ts`
- Modify: `src/reform/housing/bridge.ts`
- Modify: `src/reform/sim.ts`
- Create: `tests/reform-housing-facilities.test.ts`

**Interfaces:**
- Consumes: existing `order(g, id, kind, target?)`, `inspectOrder(g, id, kind, target?)`, `planHousing(g, a, t, need?, water?)`, `HousingSlot`, `isGame`, `library` import/export helpers.
- Produces: `HousingUsePreview = { fixtureId: string; roomId: string; fixtureKind: FixtureKind; fixtureCell: number; moveMinutes: number; useMinutes: number }` in `housing/types.ts`.
- Produces: optional `facility?: HousingUsePreview` on `HousingProposal`, `ActionOption`, and the exported `ActionPreview` return type of `inspectOrder`. `minutes` remains total movement + use. Existing callers need no change.
- Produces: `planHousing(g: Game, a: Actor, t: Task, need?: Need, water?: number, fixtureId?: string): HousingProposal | string`.
- Produces: `order(g,id,"home-use",fixtureId)` and `inspectOrder(g,id,"home-use",fixtureId)`; a successful task is still `kind:"need"`, `target:<Need>`, with existing room/station/spatial fields. `home-use` is not an accepted saved task kind.

- [ ] **Step 1: Add failing behavioral tests.** Use valid fresh housing games through current helpers; compare clones of identical states.
  - Two identical reading fixtures, closer living and farther bedroom/new room: auto selects the closer; `home-use` selects the farther and both preview and task agree on fixture, room, move+14 use. Preview calls preserve deep equality of all Game fields, including when replacing an existing task.
  - Two-seat furniture with one reserved seat uses the other, without reusing another actor's slot. Fully occupied target fails even if another fixture is free. On rejection existing task, food, reservations, time and rng are preserved (log notice is allowed).
  - Selected furniture blocked by passage/access or missing ID reports disabled and never falls back. Use a valid legacy-shaped ID such as `constructor` and same names in two rooms to verify exact ID matching without prototype/property assumptions.
  - Explicit meal reserves exactly food1, release/cancel returns once, no food/effect during travel, normal completion applies once. Save/import halfway through travel and use keeps origin and whole continuation state equal. Old no-housing game keeps old `need` behavior and rejects `home-use`.
  - Explicit bed remains available under the same injury rule as `need`; danger and transit still block. Out-of-home explicit selection fails rather than becoming field use. All six fixture needs normalize to the same old need task contract.
- [ ] **Step 2: Run focused tests and record expected failures.** `node --import tsx --test tests/reform-housing-facilities.test.ts` must fail on the missing new entry/metadata, not fixtures/import errors.
- [ ] **Step 3: Implement the interfaces.** Normalize `home-use` by strict fixture array lookup before generic need admissibility checks, while requiring home+housing first. Restrict the existing candidate loop by fixture ID and pass selected metadata out with the accepted proposal. Reuse its route/use arithmetic and tie-breaks. Do not duplicate reservation or route logic for preview. Preserve all legacy call shapes and persisted structures.
- [ ] **Step 4: Verify focused tests, full suite once, and build.** Use `node --import tsx --test tests/reform-housing-facilities.test.ts`, then `node --import tsx --test tests/*.test.ts`, `npm run build`, `git diff --check`. Record exact counts and output paths. Known direct-tsx IPC restriction makes the Node entry the working test command.
- [ ] **Step 5: Self-review and commit.** Commit only Task 1 files with `feat: let residents use a chosen home furnishing`. Write brief-matched report with red/green evidence and any concerns.

### Task 2: 生活画面の家具選択と実操作検証

**Files:**
- Create: `src/reform/FacilityAction.tsx`
- Modify: `src/reform/Life.tsx`
- Modify: `src/reform/ReformApp.tsx` (ephemeral pending facility selections across top-level views; no persisted field)
- Modify: `src/reform/life.css`
- Create: `tests/reform-housing-facilities-ui.test.ts`
- Create: `scripts/verify-room-use.mjs`
- Modify: `scripts/verify-reform.mjs` (existing hygiene duration parsing only; read explicit displayed total for facility hints, retain plain-duration fallback)
- Modify: `package.json` (add `test:room-use` only)

**Interfaces:**
- Consumes: Task 1 `ActionPreview.facility`, `ActionOption.facility`, `inspectOrder`, `order(...,"home-use",fixtureId)` and existing `house` fixtures/needLabels/cellName.
- Produces: named `FacilityAction({game, actor, command, selectedId, onSelect, onGame})` component. Types use Game/Actor/ActionOption. For six home needs, it renders a labeled controlled select plus the existing action button/hint. For non-home/legacy/non-need commands, Life keeps the existing row.
- Produces: `npm run test:room-use` operating on built `dist/yohaku.html` in an isolated Chromium context, patterned after existing standalone scripts. Root will run or document environment failure and use managed browser fallback.

- [ ] **Step 1: Add render checks then observe expected failure.** Cover six home select labels, default auto destination+separate move/use/total, food1, absence for non-housing/outside. Use real Game and inspection results, not mocks that reproduce rendering logic. `node --import tsx --test tests/reform-housing-facilities-ui.test.ts`.
- [ ] **Step 2: Implement controlled selection and hints.** Exact default option text `自動（移動と利用が短い設備）`; select label `${needLabels[need]}に使う設備`. Option labels combine room name, furnishing name, and furniture cell. Keep unavailable fixtures selectable for inspection; disable only the action with its live reason. If the selected ID disappears, preserve an explicit option/text `選んだ設備がありません` and disable the action. A fresh selection only sets React state. Auto uses original need command and original selection algorithm; specific choice uses `home-use`. Hint includes room/furniture plus `移動N分 ＋ 利用N分（合計N分）` and material reserve, and labels time as a current estimate. Use normal responsive wrapping, `min-width:0`, and width-limited selects; no new visual system.
- [ ] **Step 3: Isolate pending state.** Keep pending selections in ephemeral React state above the top-level view switch, tied to the active resident and save slot. Reset on an actual resident/slot transition, but retain them across 暮らし/住まい/地域/手帳 navigation, clock advancement, and other actors' reservations. Re-evaluate on each render. Verify same-tab removal through the existing HouseEditor leaves the missing selected ID visible with its disabled action, rather than displaying a valid-looking unrelated option. Do not add persisted data.
- [ ] **Step 4: Add browser exercise.** Through normal creation and UI or clearly labeled controlled import fixture, create same-use furniture in two rooms; select farther and confirm displayed move/use and actual destination; verify selection alone preserves clock and export; reserve one-user furniture from actor A and show actor B blocked; cancel A, choose B, use/save/reload/finish. Confirm actor and save-slot switches reset pending choice (using a fixture that exists in both slots so disappearance cannot mask failure); check320/390/1280 widths and capture screenshots. Standard script uses isolated browser context and does not access user saves. Record fixture vs normal path. No application-internal DOM evaluation; download exported save for checking.
- [ ] **Step 5: Verify render/focused tests, whole suite once, build, syntax, diff.** `node --import tsx --test tests/reform-housing-facilities-ui.test.ts tests/reform-housing-facilities.test.ts`; `node --import tsx --test tests/*.test.ts`; `npm run build`; `node --check scripts/verify-room-use.mjs`; `git diff --check`. Root owns final browser runs and full delivery evidence.
- [ ] **Step 6: Self-review and commit.** `feat: show furnishing choice and travel time in daily actions`; report exact tests and remaining browser verification, not unexecuted success.

## Final verification and delivery

After both task reviews, root runs one whole-branch review, addresses findings through the designated fix wave, and verifies the final standalone HTML through the required browser route. Preserve same-morning comparison scripts/results with reproducible public APIs, distinguish baseline and new-feature runs, and preserve private saves. Add research, decisions, review/test/browser evidence, next handoff, and minimal current-doc anchors. Save only deltas atop fresh GitHub main (preserve166 remote-only historical files), read back changed bytes, update Notion current pages and a new result page, and deliver the exact tested HTML. No Sites production deployment.
