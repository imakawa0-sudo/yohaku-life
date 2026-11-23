# Housing H1-B Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make home movement, equipment use, waiting/cancellation, legacy continuation and save/reload playable through the existing game UI.

**Architecture:** Add an optional housing runtime to Game and bind new home Tasks to H1-A orders. Keep one game clock and one material/effect owner, preserve old Tasks as unbound compatibility work, and isolate new saves with a version2 key/envelope. Build topology from existing rooms with blocked furniture and explicit interaction points.

**Tech Stack:** Existing TypeScript5.9.3, React19, Vite7, Node test runner/tsx, Playwright; no dependency upgrades.

**Spec:** `docs/superpowers/specs/2026-11-23-housing-h1b-design.md`

## Global Constraints

- 既存の人物作成10項目41選択値と外見を保持する。依存パッケージを更新しない。
- ゲームの時計を進める入口は既存 `advance` 一つ。指示・照会・表示・保存・通路設定で時間、乱数、完成効果を進めない。
- 一回のゲーム1分につき `advanceSpatial(state, 1)` を全体で一回だけ呼ぶ。結び付けたTaskを旧remainingでも二重進行しない。
- Taskが材料予約・返却・ゲーム効果を持ち、SpatialOrderが位置・利用残時間・待機・取消段階を持つ。完了と取消を混同しない。
- 旧Taskのremaining/total/reservedを推定分解・再引落ししない。元の旧保存キーと分岐元Slotを変更しない。game/originは独立に検証・複製する。
- 室内位置が不明な旧人物は未確定のまま保持する。次に受理する住居内の新指示で現在の部屋の入口0を初期位置にする規則を画面で説明する。無効な指示では初期化しない。
- 入室・設備利用の許可不足と物理的な経路不通を、判定と日本語表示で区別する。
- 家具のマスを通り抜けない。予約された設備・利用位置、人物の現在マス・着地マス、進入済み接続を壊す編集は材料を使う前に拒否し、理由を示す。
- 別タブ競合、不正保存、保存不可を区別し、保存原本を黙って上書きしない。保存の副作用をReactのstate updaterへ入れない。
- 実装後に最終HTMLをビルドし、実操作・PC/320/390pxの収まり・保存再開を確認する。未実施や代替経路を明記する。
- GitHubは既存mainの子コミットとして変更ファイルだけ保存し、読み戻す。Sites本番は公開しない。

## Review Focus

1. Cancel/replacement while already in a connection: old reservation and command persist until safe exit; invalid replacement is inert (Task2).
2. Unknown legacy location and old reserved cooking: no guessed phase, relocation on failed preview, double debit, or changed source slot (Tasks2/3).
3. House/control changes during use/transit: no occupied wall, removed admitted edge, relocated reserved interaction point, or door bypass (Tasks1/2).
4. Corrupt housing in only origin, v1 envelopes with runtime, and concurrent update/deletion during first v1 copy: reject/protect originals (Tasks1/3/4).
5. Planned rooms used as co-presence, waiting represented as countdown, and 320px long status/actor names: no remote social rewards/teleport, explain waits and contain layout (Tasks2/4).

---

### Task 1: Housing topology, state contract and validation

**Files:** Create `src/reform/housing/types.ts`, `topology.ts`, `runtime.ts`, `tests/reform-housing-topology.test.ts`. Modify only Game/Task type additions and the final housing validation hook in `src/reform/sim.ts`.

**Interfaces:**

- Consumes existing House/Game/Task and H1-A types/route/codec APIs.
- Produces HousingRuntime, HousingControls, HousingTaskBinding, HousingTopology, HousingStatus types and the spec's `buildHousingTopology`, `housingPoint`, `housingRoomId`, `createHousingRuntime`, `isHousingRuntime`, `applyHousingHouseEdit` exports. Topology exposes per-slot fixtureId/roomId/kind/seat/point metadata and stable IDs for links/doors. Export small ID/helper functions needed by later tasks instead of parsing strings in callers.
- HousingStatus must carry readable `location`, `destination`, `phase`, `detail`, nullable `minutes`, nullable `useRemaining`, and optional `waitReason`; phase distinguishes legacy/unlocated/idle/move/use/waiting/cancelling/outside.

- [x] Write failing tests for furniture obstruction and deterministic adjacent interaction point, inaccessible fixture rejection, distinct seats, link duration3, closed door blocks every incident edge, permission vs physical blockage, revoked occupant can exit but cannot use/re-enter, new vs legacy positions, ID strings containing separators.
- [x] Add corrupt-state tests: runtime/game time mismatch; actor missing/duplicated between known and unknown; wrong room; orphan or mismatched binding/slot/reservation/useRemaining; invalid controls/mealPartners; unexpected carry/item state in this live first slice. Preserve valid denied/disconnected states.
- [x] Add edit tests for wall/furniture under standing actor, transit landing, removed active connection, moved reserved fixture/point, old active task dependencies, regional departurePoint protection, no charge on rejection, and successful unrelated edit preserving runtime flags and positions. Preserve legacyStationPaths across shortcut addition/save/reload, allow the shortcut, and reject later removal of a protected link without altering old Task time/materials.
- [x] Run `node --import tsx --test tests/reform-housing-topology.test.ts` and record expected RED before implementation.
- [x] Implement types/topology/runtime as specified. Controls are canonical and must match graph; use the existing spatial validator plus semantic cross-checks. Edits clone, validate and charge only after success. No UI or gameplay tick integration in this task.
- [x] Run targeted tests, `npx tsc -b`, and formatter on touched files; record actual output. Commit this deliverable and write task report.

### Task 2: Bind the existing simulator to spatial progression

**Files:** Modify `src/reform/sim.ts`; create `src/reform/housing/bridge.ts`, `src/reform/housing/presentation.ts`, `tests/reform-housing-sim.test.ts`; adjust Task1 runtime validation only for necessary integration invariants.

**Interfaces:**

- Consumes Task1's exact exported types/topology/runtime and H1-A `issueSpatialOrder`, `cancelSpatialOrder`, `advanceSpatial`, `locateSpatial`, `inspectSpatialRoute`.
- Produces `enableHousing`, `nextCompletionMinutes`, `setHousingPassage`, `setHousingRoomAccess` exported from `sim.ts`, and `housingStatus` exported from `housing/presentation.ts`. Existing order/inspectOrder/options/advance remain the UI entry points. `home-move` target is JSON `{roomId,cell}`.

- [x] Write failing integration cases: pure preview/issue clock, actual travel+use time, no effect before completion, separate seats, correct cooking duration/material debit, one global tick for two actors, re-open resumes same order and resources.
- [x] Pin cancellation and replacement: mid-link cancel exits only that segment then refunds once; save during cancel does not revive job; invalid replacement keeps original Task/position/reservation; new replacement during transit reports safe-exit reason without modifying it.
- [x] Pin old tasks: exact remaining and reserved after enabling legacy mode, old effect once, failed new command leaves unknown position; accepted next home command initializes explicitly at current room entry. Region travel saves the historical departurePoint, cancellation restores it after reload, unknown old departure remains unknown, actual arrival home establishes the living threshold0 at that event.
- [x] Clear legacyStationPaths only when its old equipment Task completes/cancels/is successfully replaced; preserve it on failed replacement and through serialization.
- [x] Pin social boundaries: new home pair action never teleports partner and needs actual co-location; planned same-room meals and legacy unknown participants earn no shared bonus; overlapping actual use accumulates mealPartners and each completed diner gains its own bonus once.
- [x] Pin continuous/split/JSON-save-resume equality, runtime/game validation after every boundary, cancellation with multiple actors, waiting estimates nullable and next completion including route time.
- [x] Run `node --import tsx --test tests/reform-housing-sim.test.ts` RED, implement bridge and minimal sim hooks. Existing legacy mode without housing must keep old behavior. Call advanceSpatial exactly once per minute and finish/refund only on matching terminal events. Leave old Task execution unbound.
- [x] Run new targeted tests plus `tests/reform-sim.test.ts` and Task1 tests, typecheck/format; commit and report. Do not run the full suite per task.

### Task 3: Versioned library, explicit legacy fork and conflict protection

**Files:** Modify `src/reform/library.ts`, `tests/reform-library.test.ts`; create `tests/reform-housing-library.test.ts`.

**Interfaces:**

- Consumes isGame/enableHousing from Task2.
- `LIBRARY_KEY = "yohaku-reform-library-v2"`; export `LEGACY_LIBRARY_KEY = "yohaku-reform-library-v1"`. Library.format2; parse accepts legacy format1 only if no housing data, returns in-memory format2 without changing source.
- `upgradeHousingSlot(slot: Slot, name: string): Slot` creates an independent legacy-initialized housing fork of game and origin.
- readLocal returns existing fields plus optional legacyRaw witness. Export `writeLocal(next: Library, expectedRaw: string | null, legacyRaw?: string | null): LocalWriteResult` with discriminated saved/conflict/blocked/unavailable results, enough latest raw/library/witness information for UI to recover without overwriting. Final review added `invalid` for a rejected proposed payload, after validating the exact serialized bytes before any write; Task4 displays the reason and preserves the readable library. Final exact result type belongs in report for Task4.
- Export `LOCAL_LIBRARY_LOCK = "yohaku-reform-library-v2:write"` and `writeLocalCoordinated(next: Library, expectedRaw: string | null, legacyRaw?: string | null): Promise<LocalWriteResult>`. In supported environments obtain an exclusive Web Lock and invoke writeLocal inside its callback. If the API is absent use compare-before-write with a visible saved-result warning; if acquiring it rejects return unavailable without writing. The saved variant may have optional warning. Task4 awaits this wrapper.

- [x] Write tests for legacy original key/slot unchanged, current vs origin distinct and deep independent, old active cooking unchanged, v2 export/import/spatial continuation equivalence, old no-housing version1 export retained, housing smuggled under version1 rejected, corrupt only origin rejected.
- [x] Write storage tests using a small fake Storage: valid v2 priority; malformed v2 blocks fallback; v1 fallback is read-only and records witness; changed v2/raw or changed legacy witness before first write yields conflict without write; removed or corrupt concurrent save is protected; quota failures are reported as unavailable.
- [x] Test that a queued coordinated write does not read/write before its lock is granted, and two competing writes with the same witness yield one save and one conflict. Test missing Web Locks warning and rejected lock acquisition without a write. The final browser gate checks the actual API; a fake lock only proves wrapper sequencing.
- [x] Run new tests RED; implement read/copy/write/branch/import logic. No mutation of original game/origin or old key. Do not use current time or IDs during parse/read/render; create IDs only in explicit fork/import actions.
- [x] Run targeted library and housing tests, typecheck/format. Update old library assertions only where format intentionally changes. Commit/report exact LocalWriteResult API and UI migration obligations.

### Task 4: Playable UI and final integration proof

**Files:** Modify `src/reform/ReformApp.tsx`, `Life.tsx`, `HouseEditor.tsx`, `life.css`/`house.css`/`reform.css` and display-only labels in `housing/presentation.ts` as needed; create `src/reform/HousingPanel.tsx`, `tests/reform-housing-ui.test.ts`, `scripts/verify-housing.mjs`; update `scripts/verify-reform.mjs` and `scripts/verify-character-art.mjs` for legitimate v2/new-mode behavior. Controller owns final docs/PLAYTEST and GitHub/Notion.

**Interfaces:**

- Uses Task2's actual status/nextCompletion/order/control APIs and Task3's writeLocalCoordinated/upgrade functions. Await coordinated saving and handle pending repeated actions without overwriting a newer state; storage effects stay in handlers. No second duration or state calculator in UI.
- New setup result is enabled with mode=new before storing both game/origin. Existing housing-free slots stay legacy until explicit upgrade fork. Storage synchronization handles valid update, deletion and malformed values without silent overwrites; carry legacy witness until first successful new-key write.

- [x] Add render tests for named actor, actual position/destination/stage, useRemaining vs travel ETA, waiting/permission/physical reason, cancel/refund explanation, unknown-position initialization note, legacy upgrade action, new actions disabled while cancelling, and exact existing appearance option inventory.
- [x] Implement HousingPanel with room-entry and known-person approach commands; link/door open toggles; allowed residents per room. Keep instructions and effects separate from character speech. Use clear ordinary Japanese labels and keyboard-focusable controls.
- [x] Route app saves through writeLocal, explicit upgrade into new slot, and edits through applyHousingHouseEdit. Explain copying the old hand-book. Label HouseEditor estimates as equipment/entry reference when they are not based on the selected actor's real position.
- [x] Create deterministic standalone UI script: real new creation with appearance choice, issue home equipment work, advance partial, export/reload and finish once; legacy mid-task upgrade; close/reopen route waiting; transit cancel; two-tab conflict; PC and 320/390px no document overflow. Separate normal UI play from injected controlled fixtures and report both. Do not include personal save JSON in repo.
- [x] Run scoped UI/render tests and typecheck/format; commit/report. Controller then runs full tests, build, latest-HTML browser journeys, visual inspection and final branch review/fix. If Chromium cannot start, record the exact failure and use a permitted managed preview with the identical artifact, never claim the blocked script passed.

## Completion gates owned by controller

- [x] Four task reviews, final whole-branch review and one cohesive final fix/re-review completed. C1/I1/I2/M1 all addressed at059f376; final899 tests/build and final-HTML targeted replay recorded.
- [x] Full suite and final build on delivered source; actual UI verification bound to final HTML hash.
- [x] Japanese implementation/research/verification/decisions records and PLAYTEST saved.

### External persistence after fixing this source snapshot

The following operations use this fixed source. Their actual commit/readback and page results are recorded in Notion28 and the final completion report, rather than asserting an external result inside a commit that has not been uploaded yet.

- Normal GitHub commit from current remote main; read-back equality for all modified/added files, unchanged remote files retained.
- Notion current/next/progress/limits updated without completing H1/housing overall.
