# H5a Room Insulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for implementation tasks; finish with independent review and actual standalone playtesting.

**Goal:** Add a staged, spatially correct cold-protection project for one existing room, using the shared construction ledger and material flow.

**Architecture:** Optional construction kind `insulation`; completed ledger entries are the sole persisted source of room protection. Snapshot cold protection before spatial movement for each minute. Reuse hauling, build work, cancellation and save validation, and present the existing construction card in a separate compact insulation panel.

**Tech Stack:** TypeScript, React 19, existing spatial engine, Node test runner with tsx, Vite standalone build, Playwright/Chromium and managed browser fallback.

**Spec:** `docs/superpowers/specs/2026-11-26-room-insulation-design.md`

## Global Constraints

- Insulation costs wood1 and 30 actual build minutes, without skill gates; addition remains wood6/30 minutes.
- A room effect derives only from a completed insulation ledger entry. No duplicated persisted boolean/set is introduced.
- `kind` omitted means the old addition plan; malformed explicit values fail validation. Old saves remain valid.
- The target is an existing room other than `yard`; `neighborId` identifies it, staging lies there, and completed `roomId` equals it. No new room/house ID is issued.
- Only one unresolved construction project across both types. Use existing reservations, real hauling, cancellation, handoff, permissions and return flow.
- Cold protection uses actual minute-start presence. Destination/Task.room/bed reservation never confer protection; regional travel and unknown spatial location do not receive room protection.
- Preserve old whole-home insulation, its material/skill rules and home footprint; exclude active regional travel in spatial games from home protection. Existing room work/history remains usable if whole-home insulation completes meanwhile.
- PC14px/mobile13px and all existing setup choices, actions, tabs and time controls remain available.
- No Sites production publication; preserve remote history and unrelated files. Do not upload the previously rejected bulk evidence set or real user saves.

## Review Focus

Correct material accounting across both kinds; backward save validation; temporal/spatial effect boundaries; completion without creating a room; whole-home coexistence; real browser gameplay and narrow layouts. Do not add unrelated architecture or build-tool changes.

### Task 1: Construction and simulation core

**Files:** create `src/reform/housing/insulation.ts`, `tests/reform-insulation.test.ts`, `tests/reform-insulation-save.test.ts`; modify `constructionTypes.ts`, `construction.ts`, `constructionValidation.ts`, `runtime.ts`, `constructionPresentation.ts`, `sim.ts` and only directly required housing modules. Do not edit React UI or browser scripts.

**Interfaces:** export `createRoomInsulation(game: Game, request: { roomId: string; stagingCell: number }): ConstructionResult`, `isRoomInsulated(game: Game, roomId: string): boolean`, `isIndoorHousingRoom(game: Game, roomId: string): boolean`, `homeColdProtection(game: Game, actor: Actor): "whole-home" | "room" | null` from insulation.ts. Expose a shared display helper `constructionTitle(plan)` if needed for both panels. Document actual interfaces in the task report.

1. Read the spec and existing construction test helpers; write meaningful failing behavioral tests first. Run via `node --import tsx --test <focused files>` because the environment's `npm test` tsx CLI has an IPC bind limitation. Confirm intended failure, not a malformed import/setup.
2. Add optional plan kind, enforce per-kind material values, build the new project through existing machinery, and complete it automatically at 30 build minutes without editing the house shape. Reuse the existing engine completion call; the final work minute remains unprotected. Keep cancellation and progress semantics common.
3. Validate old/new ledger relations. Reject unknown/duplicate/outdoor targets, incorrect quantities, inconsistent completion IDs and kinds, effects without completed valid work, and insulation before its target room was built. Permit valid post-completion furniture/size edits and do not require a new room ID for insulation. Keep whole-home coexistence valid.
4. Derive room protection from completed plans. Capture each actor's protection before `advanceHousingMinute` and use it in frost drain. Preserve exact existing decay multipliers. Test arrivals, departures, cold body, outside and legacy/unlocated.
5. Make construction presentation and task labels type-aware and quantity-aware. No React editing in this task.
6. Verify focused tests and the full existing suite; report any environment command failure. Commit only this task's source/tests. Write a report with RED/GREEN evidence, files, interfaces, verification and remaining concerns.

### Task 2: Room controls and visible cold status

**Files:** create `src/reform/InsulationPanel.tsx`, `tests/reform-insulation-ui.test.ts`; modify `ConstructionPanel.tsx`, `ReformApp.tsx`, `Life.tsx` and relevant existing CSS only if required. Add `scripts/verify-insulation.mjs` and package script only if it provides runnable meaningful browser verification beyond the normal scripts. Do not change simulation/validation behavior.

**Consumes:** Task1 createRoomInsulation/isRoomInsulated/isIndoorHousingRoom/homeColdProtection and the shared construction model/card.

1. Test rendered availability, honest cost and duration, construction-kind ownership and cold status semantics before implementing. Use real render components and hand-derived expected behavior; avoid tests merely matching source text.
2. Export/reuse ConstructionCard and the typed action runner. Make its material labels use plan.requiredWood. Keep additions in the existing region and insulation cards in the new region so there is one visible card per project.
3. Add a compact panel with target room + staging selection, progress and return controls, disabled reasons for whole-home protection/active other work, and completed room state. Planning is free even with no wood; material shortage disables only reservation. State that yard is outside the target. Keep old addition flow intact.
4. Display selected actor's effective cold protection after frost in Life, deriving the same location-aware status as the engine. Explain the excess fatigue rather than inventing temperatures or health effects.
5. Keep errors actionable and no state/time changes from previews or selecting controls. Use semantic labels for keyboard/mobile operation and upcoming real browser test.
6. Run relevant render/integration tests and build. Commit this task's source/tests/script files; write report with real failures observed, fixes, and verification limits.

### Task 3: Verification, research and handoff

**Files:** update `docs/PLAYTEST.md`, `docs/DEVELOPMENT_HANDOFF.md`, `docs/DESIGN.md`, `docs/ROADMAP.md`, `README.md` where needed; add a concise `docs/HOUSING_H5A_INSULATION.md` with primary-source research, adopted decisions and actual results. Keep raw/synthetic browser evidence in scratch rather than bulk GitHub upload.

1. Independently review Task1 and Task2 with spec + quality verdicts, resolve material findings before continuing. Run one final broad review of all source changes.
2. Run npm test (record exact result), verified alternate direct node runner if required, and npm run build. Use the latest dist/yohaku.html for standard standalone desktop/mobile checks, recording launch failures honestly if they recur.
3. Actually play a fresh-save insulation loop, cancelled return, reload mid-task, and frost comparisons; inspect PC and mobile layouts/screenshots. If production code changes, rerun affected checks and rebuild before final artifact. Match final file hash to the tested artifact.
4. Document current official references and their limits; identify this game's choices separately. Use Context7 for relevant TypeScript docs; check Context7 Admin/Docs7 index status without retrying the known 10-day refresh lock.
5. Sync the bounded changed source/test/docs set to current GitHub main with expected-head guard and no history rewrite. Update existing Notion roadmap/spec/handoff and add a focused result page. Save deliverable standalone HTML for the user. Report exact versions, observed verification, and unverified scope.
