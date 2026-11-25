# 優先する寝床 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 住人の優先寝床を保存し、通常の休息で利用可否に従って選択・代替し、その理由を画面で確かめられるようにする。

**Architecture:** 省略可能な住居設定を小さな専用モジュールで扱い、既存の検証・家編集・設備計画に接続する。計画時の予告だけに優先／代替の情報を付ける。UIは保存済み値を直接読むcontrolled selectを使い、既存の一回指定と独立させる。

**Tech Stack:** React 19.3.1 / TypeScript 5.9.3 / Vite、node:test、既存Playwright。

**Spec:** `docs/superpowers/specs/2026-11-24-housing-bed-preference-design.md`

## Global Constraints

- React 19.3.1 / TypeScript 5.9.3、既存依存を維持し、依存の追加・更新を行わない。
- 設定だけで時間・乱数・現在の行動・予約・在庫・originを変えない。
- 一回の明示指定を黙って代替しない。競合・許可・到達の既存規則を迂回しない。
- 未設定の選択、他の用途、旧保存の行動と出力を保つ。新しい部屋補正や家具性能・費用の変更は行わない。
- PC本文14px・スマートフォン13px、操作領域44px以上、4タブと中央時計、元の画像を維持する。
- Game.versionは1、HousingRuntime.versionは1、手帳formatは2、書出しの現在の形式区分を維持する。
- 一般の `need / energy` だけが対象。`recover`・野外・住居未有効の旧保存へ適用しない。
- 設定は専有権ではない。二人が同じ寝床を優先でき、既存の予約順序を保つ。
- GitHub・Notionへの保存と最終HTMLの提供は既存の継続許可の範囲。Sites本番公開は行わない。

## Review Focus

1. 設定中に移動・睡眠・食事が進行している場合、設定以外の全状態を保持する（Task 1）。
2. 同じ寝床を二人が希望し、先客の予約が移動中／利用中／取消後に変わる場合、横取りせず次回に再評価する（Task 1）。
3. 撤去・移設・閉扉・入室禁止で参照先の可用性が変わった場合、受理された撤去だけで設定を解除する（Task 1）。
4. `constructor` などの実人物ID、壊れた保存、現在とoriginの異なる設定を安全に区別する（Task 1）。
5. 同名の部屋・同種の寝床と住人／保存の切替えで、設定値・予告・一回指定の対象を混同しない（Task 2）。

---

### Task 1: 設定・保存・通常休息の選択

**Files:**
- Create: `src/reform/housing/bedPreference.ts`
- Modify: `src/reform/housing/types.ts`, `src/reform/housing/runtime.ts`, `src/reform/housing/bridge.ts`
- Test: `tests/reform-housing-bed-preference.test.ts`, `tests/reform-housing-bed-preference-library.test.ts`

**Interfaces:**
- Consumes: `Game`, `Actor`, `Task` types from `src/reform/sim.ts`; existing `HousingRuntime`, `HousingUsePreview`, house furniture metadata, `planHousing`, `isHousingRuntime`, `applyHouseShape`, library public import/export/branch functions.
- Produces: `HousingRuntime.preferredBeds?: Record<string, string>`.
- Produces in `bedPreference.ts`: `getPreferredBed(game: Game, actorId: string): string | undefined`; `setPreferredBed(game: Game, actorId: string, fixtureId: string | null): Game`; `isBedPreferences(value: unknown, game: Game): value is Record<string, string>`; `prunePreferredBeds(game: Game): void` (mutates only the already cloned candidate in accepted house edits).
- Produces optional `HousingUsePreview.bedPreference`: `{ fixtureId: string; outcome: "preferred" } | { fixtureId: string; outcome: "fallback"; reason: string }`. The ID always names the configured preferred fixture; outer `facility.fixtureId` names the actually selected fixture. Metadata is preview-only and is not copied into saved Task.
- `planHousing` keeps its existing signature. It considers the setting only when `need === "energy"`, no explicit fixture ID was supplied, and the operation is ordinary need use. Setting has no effect on other uses or `recover`.

- [x] **Step 1: Write failing behavior tests for configuration and planning.** Build valid house states through existing public APIs. Assert a farther/slower preferred mat is selected over an eligible nearer/faster bed; without settings the baseline winner and all Game data are unchanged. Assert `inspectOrder` is pure and `order` starts exactly the previewed station. For setting/clearing, compare the entire Game after removing only `housing.preferredBeds`; assert equality including active task, reservations, stock, time, RNG and logs. Exercise active move/use/food and an outside resident. Assert invalid actor, wrong fixture kind, nonexistent ID, same value and absent housing return the original object.

- [x] **Step 2: Run the new test file before implementation.** Run `node --import tsx --test tests/reform-housing-bed-preference.test.ts`. Record the feature-specific RED output; fix setup mistakes rather than calling them evidence of the missing feature.

- [x] **Step 3: Implement settings and selection.** Add the exact optional types and helper signatures above. Use own keys, safe object construction and plain/null-prototype validation. Do not add empty settings to old data. Clearing the last entry omits the property. In the existing candidate-selection loop, eligible preferred slots outrank nonpreferred slots; otherwise preserve the original minutes/slot-ID ordering. Collect failure reasons for the preferred fixture using existing reason text and attach the discriminated preview metadata. Do not start another task or mutate the input during planning.

- [x] **Step 4: Add failing competition, permission and edit tests, then implement only required integration.** Assert two residents may share a preference, the first accepted reservation is kept, the second gets an eligible fallback with `outcome === "fallback"` and a reason; explicitly naming the busy preferred bed is refused without losing the prior task. After cancellation/completion and safe exit, ordinary rest uses the preferred fixture again. Test closed path/room access fallback, restoring access, no available alternative, and automatic low-energy/night rest. Assert moved same-ID furniture retains the setting, accepted idle removal prunes only affected settings, and rejected active removal leaves the full original Game. Add validation to `isHousingRuntime` and prune in the already validated house-edit candidate before its final validation; never sanitize invalid imported saves.

- [x] **Step 5: Add failing persistence tests, then complete validation.** In `reform-housing-bed-preference-library.test.ts`, assert old saves remain valid and byte-equivalent without an injected map; current/origin remain separate across export/import/reload and both branch modes. Reject unknown actor, wrong/missing fixture, non-string values, array/null/custom prototype maps. Accept a legitimate own `constructor` actor ID and empty plain maps. Preserve existing blocked-read/raw-data protection; no changes to library format or older-reader promises.

- [x] **Step 6: Verify and self-review.** Run the two focused test files, `npx tsc --noEmit`, then `node --import tsx --test tests/*.test.ts` once after final edits. Record exact output and every failure. Tests verify real behavior; use no mocks or production-only testing hooks.

- [x] **Step 7: Commit.** Commit only this task's product and test files with `feat: persist resident bed preferences for ordinary rest`. Write the full report including RED/GREEN evidence and concerns to the assigned task report path.

### Task 2: 寝床の方針と選択理由の画面

**Files:**
- Create: `src/reform/facilityLabel.ts`, `src/reform/BedPreferencePolicy.tsx`
- Modify: `src/reform/FacilityAction.tsx`, `src/reform/Life.tsx`
- Modify: `scripts/verify-reform.mjs` (the two existing policy Fold selectors only)
- Modify only if required for the new controls: `src/reform/life.css`
- Test: `tests/reform-housing-bed-preference-ui.test.ts`
- Create: `scripts/verify-bed-preference.mjs`
- Modify: `package.json` (add `test:ui:bed-preference` script; no dependency changes)

**Interfaces:**
- Consumes Task 1: `getPreferredBed(game, actorId)`, `setPreferredBed(game, actorId, fixtureId | null)` and the exact `HousingUsePreview.bedPreference` union above.
- Produces: `facilityLabel(rooms: Room[], room: Room, kind: FixtureKind, cell: number): string` exported from `facilityLabel.ts`; preserve the existing room/furniture/row-column/same-name ordinal output.
- Produces: `BedPreferencePolicy({ game, actor, onGame }: { game: Game; actor: Actor; onGame: (game: Game) => void })`. This is a compact label/select/help fragment inside Life's existing policy Fold, and returns nothing when housing is absent.
- Keeps existing `FacilityAction` props and one-off draft handling in `ReformApp` unchanged.

- [x] **Step 1: Write failing rendered-UI tests.** Render real valid Game/Actor states with React SSR as existing UI tests do. Assert label `{住人名}が優先する寝床`, selected option from the Game, no control without housing, setting available outside home, only rest furniture listed, and distinct same-name room labels. Render preferred, fallback, unconfigured and explicit-one-off action states; assert actual destination and time sum, required copy below, fallback preferred-name/reason, and absence of preference metadata text on explicit one-off orders. Render two residents and two saves with different settings to prove the value comes from the corresponding Game.

- [x] **Step 2: Run `node --import tsx --test tests/reform-housing-bed-preference-ui.test.ts` and record the expected RED before UI edits.**

- [x] **Step 3: Implement the shared label and persistent control.** Extract the existing label without changing its text. Rename the existing policy Fold `仕事と備蓄の方針` to `暮らしと備蓄の方針`; insert the control between work priority and food stock. Select value is `getPreferredBed(game, actor.person.id) ?? ""`; onChange synchronously calls `onGame(setPreferredBed(..., value || null))`. Do not keep a duplicate local selected state. Update the two existing standalone verification selectors in `scripts/verify-reform.mjs` from `仕事と備蓄の方針` to the new Fold title so the required existing scripts still exercise that section. Exact blank option: `未設定（使える寝床から選ぶ）`. Exact help: `次の休息から優先します。使えない時は別の寝床を探します。今の予定は変わりません。`

- [x] **Step 4: Implement truthful action previews.** Unconfigured automatic copy remains `自動（移動と利用が短い設備）`. Configured energy automatic copy is `自動（優先する寝床を考慮）`. Preferred outcome adds `優先する寝床を使う見込みです。`; fallback shows the preferred target's full shared label, the returned reason, and `別の寝床を使う見込みです。`. Continue showing the actual destination and move+use=total. Explicit selection uses only its own preview and does not change the saved preference. Disabled actions keep the existing reason. No preview-only state is persisted.

- [x] **Step 5: Write the standalone browser acceptance script.** Follow `scripts/verify-room-use.mjs` for Playwright setup and real built HTML loading, using a new isolated context. Normal UI path: start 木工の二人, enable housing as needed, add a second resting fixture through House controls, set each resident's preference, confirm clock unchanged, request default rest, progress time, reload, export/import and current/origin branches. Controlled imports cover same-bed competition, inaccessible preferred bed and active-task setting changes. Check PC1280,390,320 widths and long/same-name labels; assert no horizontal overflow and controls usable. Export checkpoints to compare Game/origin through existing validators outside the browser. Generate validated controlled import files and their ID/label manifest under the output directory before launching the browser. Support `BED_PREFERENCE_PREPARE_ONLY=1` to prepare those same files without launching, so the controller can run the same cases through managed Chrome if the local launcher is unavailable. Expose `test:ui:bed-preference`; report a launcher failure before page load as infrastructure, never as a passing UI test.

- [x] **Step 6: Verify and self-review.** Run focused UI/facility tests, `npx tsc --noEmit`, then `node --import tsx --test tests/*.test.ts` once after final edits. Do not repeat an already known blocked browser launcher in a loop. The controller performs final build/browser checks on the reviewed final tree. Keep detailed exact outputs in the report.

- [x] **Step 7: Commit.** Commit only Task 2 files with `feat: show persistent bed policy and fallback previews`. Write full RED/GREEN and self-review report to the assigned path.

## Controller verification and delivery

After both task gates, run one whole-branch review against the spec; apply the prescribed aggregated fix and scoped re-review if necessary. Archive comparison code/results, source notes, decisions and review evidence in `docs/research/housing-bed-preference-2026-11-24/`.

Run required `npm test`, build and standalone/browser scripts on the final code. If Chromium cannot launch in this host, record the precise pre-page failure and execute the corresponding acceptance cases in available managed Chrome against the identical built HTML. Keep normal UI steps and controlled imports separate; record exports and screenshots, full-state/origin checks, HTML size/hash, and any unverified cases. Replay the fixed day condition with/without preferences and explain fallback causes without generalizing a single day's stock.

Use fresh GitHub main as the remote parent, apply only local changes since `367ecdd81e169857ba4d0e0227fd74c4fff788b4`, preserve all remote-only paths, compare candidate full tree, CAS-update main and read back every changed byte. Update Notion result/current/roadmap/next without marking broad H4 complete. Provide the verified standalone HTML and summarize implemented behavior, comparison evidence, verification, limitations and chronological rulings. Archive the completed ledger before deleting only this plan's ignored workspace.
