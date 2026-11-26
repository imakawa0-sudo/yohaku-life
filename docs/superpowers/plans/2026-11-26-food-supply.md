# H6b Food Supply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同じ保管床へ食材一束を補充する担当を保存し、繰返しの準備・運搬指示を減らす。

**Architecture:** `HousingRuntime.foodSupply?` は現物台帳と独立した任意設定。既存の一束作成・運搬を再利用し、毎分の自律選択で条件を満たした担当者だけが原子的に開始する。食事・料理・直接指示と現物台帳の責務を保つ。

**Tech Stack:** React 19.1、TypeScript 5.9.3、現行Vite/tsx/node:test。新依存なし。

**Spec:** `docs/superpowers/specs/2026-11-26-food-supply-design.md`

## Global Constraints

- 一つの補充担当、一つの保管床、現物一束（食材2）。共有在庫からの料理と手動の一束操作を維持する。
- 設定・プレビュー・読込・タブ切替は時間を進めず、材料とTaskを新設しない。開始は次の時間進行。
- 有効な直接指示と生活の急務を優先し、補充のために進行中のTaskを中断しない。毎分の処理でactors配列や現在人物の参照を置換しない。
- 保存は任意追加・旧保存への注入なし。現物・Task・命令・予約の相互照合を維持し、auto許可は一束のstore運搬だけ。
- PC本文14px/モバイル13px以上、既存の時計・全住人の進行を保持。新依存なし。以前の非公開保持証跡を公開対象へ混ぜず、Sites公開は行わない。

## Review Focus

- 方針停止/解除後も進行中のauto運搬が保存・完了できること（Task 1）。
- 無効な直接指示が進行中の現物/予約/方針を失わないこと（Task 1）。
- 現物がないときの補充先を改築で消せないこと、解除後に通常制約へ戻ること（Task 1）。
- 自律開始が同じ分の別人物の成果/予約を壊さないこと（Task 1）。
- 忙しい住人の担当設定、保存失敗、設定と現物担当の区別がUIで分かること（Task 2、実操作は最終試遊）。

## File Structure

- `src/reform/housing/foodSupply.ts`: 設定API、読み取り専用の状態表示、毎分開始。単一責務の既存型をfoodTypesへ加える。
- `src/reform/housing/foodSupplyValidation.ts`: 任意設定の構造と人物/床照合。
- 既存 `food.ts`, `foodValidation.ts`, `runtime.ts`, `types.ts`, `sim.ts`: 小さな接続と停止/返却/改築規則。
- `src/reform/FoodSupplyPanel.tsx`: 確定した補充方針とフォーム。FoodLogisticsPanelから呼ぶ。
- `tests/reform-housing-food-supply*.test.ts`: 動作/保存/UIの具体的境界。
- `scripts/compare-food-supply.mts`: 前後の繰返し比較と人工保存の生成。
- `docs/HOUSING_H6B_FOOD_SUPPLY.md` と既存の進捗文書: 検証した範囲・判断・次段階。

### Task 1: 補充方針、毎分開始、保存と境界

**Files:**
- Create: `src/reform/housing/foodSupply.ts`, `src/reform/housing/foodSupplyValidation.ts`
- Modify: `src/reform/housing/foodTypes.ts`, `types.ts`, `food.ts`, `foodValidation.ts`, `runtime.ts`, `src/reform/sim.ts`
- Test: `tests/reform-housing-food-supply.test.ts`, `tests/reform-housing-food-supply-save.test.ts`

**Interfaces:**
- Consumes: existing `createFoodBundle`, `assignFoodHaul`, `presentFood`, `foodTaskMinutes`, `constructionFloor`, `housingPoint`, `order`, `advance`, `isGame` and formal save helpers.
- Produces in foodTypes: `FoodSupplyPolicy = { version:1; actorId:string; storage:SpatialPoint; enabled:boolean }`; `FoodSupplyInspection = { state:"unset"|"paused"|"hauling"|"stocked"|"waiting"|"ready"; detail:string; minutes:number|null }`.
- Produces in foodSupply: `setFoodSupply(game:Game, request:{actorId:string;roomId:string;storageCell:number}):FoodResult`; `setFoodSupplyEnabled(game:Game, enabled:boolean):FoodResult`; `clearFoodSupply(game:Game):FoodResult`; `inspectFoodSupply(game:Game):FoodSupplyInspection`; `tryFoodSupply(game:Game, actor:Actor):boolean` (mutates only passed simulation clone on success).
- Produces validation: `isFoodSupply(value:unknown, game:Game, housing:HousingRuntime):value is FoodSupplyPolicy`. Builder can adapt a helper's internal arguments if required by validation order; public four UI APIs/types stay fixed.

- [ ] **Step 1: Write meaningful failing boundary tests.** Cover no-time/no-stock setting/preview, invalid actor/floor and immutability, absent old saves, closed route before start leaves no ledger/stock change, normal auto delivery, subsequent consumed bundle replenishes once, active/manual/different-storage bundle reuse rules, busy/direct/away/night/injury49 vs50/needs41 vs42/mood24 vs25, cancellation pause vs valid other-direct-command retains policy, invalid direct command preserves state, successful return pauses and failed return does not, pause/clear mid-haul completes, remodel protection/clear, second actor same-minute work preserved. Save at a carried interval and after pause/clear and compare continuation; reject malformed/unknown config and auto cook/return while preserving legitimate store.
- [ ] **Step 2: Run focused tests to establish RED.** `node --import tsx --test tests/reform-housing-food-supply*.test.ts`; record why failing.
- [ ] **Step 3: Implement the spec.** Existing selectAuto precedence stays; insert trial before normal daytime work, with the additional exact eligibility in the spec. Use create+assign on isolated candidate state and adopt only successful relevant state while preserving g.actors and actor identity. Narrow auto mode in the validator, not all food task kinds. Preserve after-clear auto validity. Configuration supports currently busy/away actors. Successful direct return actions and explicit cancel of auto food haul pause the policy; internal safety cancellation and valid alternate direct instructions do not. Protect configured source/storage while enabled or paused. No product UI changes in this task.
- [ ] **Step 4: Verify.** Focused supply tests plus existing food/construction/save regression groups, then one full `node --import tsx --test tests/*.test.ts` and `npm run build`. Do not repeatedly run full suite during iteration. Record exact pass counts, build result, and concrete limitations.
- [ ] **Step 5: Self-review and commit only this task.** Read own diff for duplicate reservations, side effects from inspection, actor references, malformed states and unknown keys. Report public API details and commands in the task report. Do not include unrelated scratch or old evidence.

### Task 2: 補充担当を設定・停止・再開する画面

**Files:**
- Create: `src/reform/FoodSupplyPanel.tsx`
- Modify: `src/reform/FoodLogisticsPanel.tsx`; `src/reform/housing/foodSupply.ts` の開始可能の案内文のみ。Existing style file only if necessary to preserve readable/narrow layout.
- Test: `tests/reform-housing-food-supply-ui.test.ts`

**Interfaces:**
- Consumes: Task 1's four nonmutating public APIs and `inspectFoodSupply`, `FoodSupplyPolicy`, `FoodSupplyInspection`; existing onGame `(game:Game)=>Promise<boolean>|void` persistence contract.
- Produces: `FoodSupplyPanel({game,onGame})` inside the existing food section, configured policy displayed independently of current bundle assignment.

- [ ] **Step 1: Write failing render tests.** Render has no mutation; unset/configured/paused/hauling/stocked/blocked/busy displays; named controls and explicit pause-vs-cancel explanation; busy/away actor remains selectable; shared stock/manual food controls preserved. Avoid mere source-text assertions.
- [ ] **Step 2: Run focused UI test for RED.** `node --import tsx --test tests/reform-housing-food-supply-ui.test.ts`.
- [ ] **Step 3: Implement the controls.** Heading/region `一束の補充を任せる`; selects `補充担当`, `補充先の部屋`, `補充先の床`; commit button `この担当で補充する`; policy buttons `補充を一時停止`, `補充を再開`, `補充担当を解除`. Existing configured policy is visible across tab switches/load. Configuration/preview never starts an order. Pause/clear explanation says current haul finishes; existing cancel explanation for an auto food haul says policy also pauses. Render waiting detail from engine inspection and no internal IDs. onGame false shows save error without falsely displaying success. Forms can remain after a rejected edit so it can be corrected. Reuse existing accessible controls/CSS and mobile text sizes. Carry Task 1 review's Minor: ready detail in foodSupply.ts must say `今の条件なら補充を始められます。` because an earlier actor can consume remaining ingredients on the next tick; avoid promising that the next tick will start it. Assert this conditional wording in the ready UI case.
- [ ] **Step 4: Verify focused new+existing food UI tests and build.** Controller will test exact built HTML in managed Chrome; do not install alternate browser dependencies or claim unrun interaction coverage.
- [ ] **Step 5: Self-review and commit only task files.** Report accessible names, persistence handling, checks and remaining actual-browser scenarios.

### Task 3: 再現比較、境界保存、開発資料

**Files:**
- Create: `scripts/compare-food-supply.mts`, `docs/HOUSING_H6B_FOOD_SUPPLY.md`
- Modify: `docs/DEVELOPMENT_HANDOFF.md`, `docs/ROADMAP.md`, `docs/PLAYTEST.md` only with verified bounded new-stage facts; do not rewrite historical sections.

**Interfaces:**
- Consumes: core Task 1 APIs, current H6a recipe/house/save APIs; internal baseline `/workspace/scratch/c1f1ef67bbbc/h6b-research/repeated-baseline.mts` and summary.
- Produces: deterministic repeated-cooking comparison runnable with `node --import tsx scripts/compare-food-supply.mts`; summary and optional synthetic saves in a CLI-selected output directory; no personal saves. Before-after JSON data also lives internally at `/workspace/scratch/c1f1ef67bbbc/h6b-research/`.

- [ ] **Step 1: Implement the focused reproduction.** Reuse the baseline's controlled generation, same actor/stock/fixture conditions, and distinguish total time, cooking time, policy/main/cancel/wait commands, other actor work, inputs/outputs. Compare shared, self/manual, helper/manual and helper policy near/far placement, with identical start conditions. Assert state validity, stock/output conservation, and formal save continuation at representative stages. Do not turn every timing value into a brittle unit test. End with no extra fourth bundle by stock6. Include synthetic one-bundle hauling/blocked/paused cases for the controller's UI import test if useful, explicitly test-only.
- [ ] **Step 2: Run comparison and inspect results.** Record commands/results and distinguish any necessity to wait for current work. The expected reduction from 9 to 4 main instructions is a hypothesis until measured. Do not claim speed gain without measured evidence.
- [ ] **Step 3: Write bounded development documents.** Explain selected approach and alternatives, engine/UI behavior, before/after comparison and limits, official sources/dates, backward compatibility, remaining roadmap scope. Reference supplied Context7 findings as TypeScript 5.9.3 technical confirmation only, not confirmation of game design. Docs7 settings are unchanged; no index refresh assertion. Reserve actual-browser and final artifact verification for the controller until done. Keep implementation+automated+actual-play status distinct.
- [ ] **Step 4: Verify docs agree with exported APIs and measured output; commit task files.** Report exact changed files and comparison evidence. The controller adds final actual-play result and commit/artifact links after tests, then final whole-branch review covers the product and docs together.

## Controller delivery gates

- Fresh independent review after each task; resolve Important findings before next implementation.
- Actual latest HTML loop at normal and narrow width, fix/rebuild/replay as needed; final full suite/build on final source only when concrete source changes require it.
- One whole-branch final review with one fix wave/scoped rereview if needed.
- GitHub publish only local delta from `e534148293fddbf4b96526424337b21eec719cf3` atop fresh remote main; preserve remote-only history, exclude earlier withheld artifacts. One related commit.
- Persist exact tested standalone HTML, create Notion result page and update roadmap's current section. No Sites deployment. State known verification limits in delivery.
