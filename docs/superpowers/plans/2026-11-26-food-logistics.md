# H6a Food Logistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 食材2の一束を、実際の床・人・料理設備を通して保管・運搬・消費・返却できるようにする。

**Architecture:** 任意の `HousingRuntime.foodLogistics` 台帳と既存 `SpatialItem` を一対一で結ぶ。carryを既存の空間時計で進め、基本料理の指定時だけ搬送からuseへ連結する。共有備蓄・自主行動・既存料理・工事は維持する。

**Tech Stack:** TypeScript 5.9.3、React、既存のNodeテスト、Vite単体HTML、Playwright。依存追加なし。

**Spec:** `docs/superpowers/specs/2026-11-26-food-logistics-design.md`

## Global Constraints

- 材料の種類は今回 `vegetables` 一種類、数量は2固定、現存する束は一つ。
- 供給口は `living/0`。保管先は供給口と異なる歩行可能な床。選択・予約指示では時計を進めない。
- `CookingFacilitySelection` は必須の `fixtureId:string` を維持し、`bundleId?:string` を追加する。一束は `work` の `cook`／`cook:easy` のみ。
- 束を使う料理の `Task.reserved` は空。共有食材を二重に減らさず、料理完成時だけ現物を消費する。
- 取消で現物を共同備蓄へ瞬間返却しない。床ならその床、通路途中なら区間の終点に残す。
- 旧保存では `foodLogistics` を追加せず受け入れる。既存の直接指示・自主行動・工事・料理三段階・人物作成を維持する。
- 工事と食材の現物ID集合が `state.items` と完全一致することを確認する。件数だけの差し引きにしない。
- 依存ライブラリ・コンパイラ設定は更新しない。ゲームの時間進行と結果反映をUIから分離する。
- 最新単体HTMLの実操作と320／390／1280pxの確認を行い、通常プレイと制御した保存を区別する。
- GitHubは既存main履歴を保つ一つの関連コミット。Sites公開と、前工程の詳細保存・画像・生ログ一式の再送は今回の対象外。

## Review Focus

1. 取りに行く／手持ち／料理／安全取消途中を保存しても、担当・束・設備が一対一で続き、食品が増減しない（Task 1）。
2. 搬送中の料理席を別の直接料理・自主料理・共同食事が使用せず、台所の別席は使える（Task 1）。
3. 担当許可・通路・改装が変わっても、安全停止と現物回収ができる。完了履歴が後の改装を妨げない（Task 1）。
4. 一束が使用済み・他者担当になった後のUIの古い選択が、共同備蓄を勝手に使わず、理由を示す（Task 2）。
5. 同じ分の他住人の採集／料理で在庫が変わるとき、返却上限1e9と料理一度限りの会計を守り、比較で他人の結果と混同しない（Task 1、Task 3）。

---

### Task 1: 食材台帳・実運搬・指定料理・保存をつなぐ

**Files:**
- Create: `src/reform/housing/foodTypes.ts`, `food.ts`, `foodProgress.ts`, `foodValidation.ts`, `foodPresentation.ts`（必要なら料理計画だけ `foodCooking.ts` に分ける）
- Modify: `src/reform/housing/types.ts`, `bridge.ts`, `runtime.ts`, `constructionValidation.ts`, `gathering.ts`, `presentation.ts`, `src/reform/sim.ts`
- Test: `tests/reform-housing-food-logistics.test.ts`, `tests/reform-housing-food-cooking.test.ts`, `tests/reform-housing-food-save.test.ts`

**Interfaces:**
- Consumes: `issueSpatialOrder`, `cancelSpatialOrder`, `advanceHousingMinute`, `planHousing`, `isStockQuantity`, `order`, `inspectOrder`, `advance`, `isGame`, 既存保存のserialize/parse入口、`HousingRuntime`。
- Produces in `food.ts`: `createFoodBundle(game: Game, request: {roomId:string; storageCell:number}): FoodResult`、`assignFoodHaul(game:Game,bundleId:string,actorId:string,direction:"store"|"return"):FoodResult`、`returnFoodBundle(game:Game,bundleId:string):FoodResult`、`inspectFoodHaul`（同じ入力）と `inspectFoodReturn(game,bundleId)` → `FoodInspection`。
- Produces in `foodTypes.ts`: `FoodResult = {game:Game; error?:string; bundleId?:string}`、`FoodInspection = {ok:boolean; disabled?:string; minutes:number|null}`、仕様の判別可能な `FoodBundle`／`FoodLogistics`／`FoodAssignment`。`foodBundleQuantity = 2`。
- Produces in `foodPresentation.ts`: `foodBundleStatus(game:Game): FoodBundleStatus|null`。statusは `bundleId`, `state`, `quantity:2`, `phase`（日本語）, `location`（日本語）, `storage:string|null`, `assignedActorId?:string`, `minutes:number|null` を持つ。`foodTaskMinutes(game,actorId):number|null` は全残工程の予告。
- Produces in `sim.ts`: 既存 `order`／`inspectOrder` のselectionに任意 `bundleId` を受け入れる。`ActionPreview` に `foodBundle?: {bundleId:string; quantity:2; location:string; transportMinutes:number}` を追加し、料理設備予告のuseMinutesと区別する。束利用は必ずfixtureIdを明示。
- Internal helpersの名前・最適なモジュール配置は実装者が決める。公開interfacesは変更が必要なら実装前にrootへ伝える。

- [ ] **Step 1: 最初の失敗する物資会計テストを作る。** 自由食材6から一束を作ると時刻不変・自由4・living0に現物2、二束目を拒否。返却前の取消が自由4を維持することを断定する。機能欠落による失敗を記録する。
- [ ] **Step 2: 台帳と運搬を実装する。** 取り分け・担当・保管先へcarry・床で中断・通路末に中断・別人へ交代・供給口へreturn・返却をつなぐ。上限超過なら現物を供給口に残す。明示返却だけを再実行できるようにし、取り分けた直後の束を毎分自動返却しない。
- [ ] **Step 3: 料理接続の失敗するテストを作り、実装する。** `order(g,id,"work","cook",{fixtureId,bundleId})` で自由4は不変、束と席を確保、他者同席0を拒否、台所席1は使える。搬送到着分に食事を作らず、次の分から料理。既に使用床にあればcarry省略。既存の食数・経験と同じ、一度限りの結果を断定する。
- [ ] **Step 4: 取消・競合・安全境界をテストして実装する。** 拾う前／手持ち／useの取消、閉じた通路の待機と再開、許可剥奪・重傷・危険の安全中断、設備・物資床の改装拒否、終端履歴後の改装、工事の同時別物資、旧共有料理・自主料理の非回帰を確認する。invalid selectionで現行タスクが失われないことを含める。
- [ ] **Step 4a: 実際の操作地点と完成食の上限を確認する。** 経由しない保管室の許可がない人でも、実際の拾得床と設備を使えるなら直接料理できる。運搬後の加工には以前の供給元の許可を要求しない。一束料理の完成食が1e9を超える場合、束を使用床へ残し担当・席を解除、食事・経験を付けない。食数計算は既存料理と共有する。
- [ ] **Step 5: 旧保存と敵対的な入力の失敗するテストを作り、validatorを実装する。** 束ID／担当／注文／item／設備の双方向一致、余分なitem、終端に現物、数量違い、未来時刻、重複席、安全でないnextId、明示undefined/null等を拒否。正常な現物各段階・game/originの書出し読込みは通す。途中保存からの継続Gameを、保存なしの継続GameとdeepEqualする。
- [ ] **Step 6: 予告と本体を検証する。** 一束料理のinspectが元Gameを全く変えず、予告が実完了時間と一致すること、次の完了が搬送で料理終了と誤らないこと、他住人の同分在庫変化でも上限と一度限り会計を守ることをテストする。
- [ ] **Step 7: 全試験と型検査・ビルドを実行する。** `node --import tsx --test tests/*.test.ts`、`npm run build`。標準npm testは既知のtsx IPC制約と区別し、必要なら一度のみ確認。失敗は省略せず報告する。
- [ ] **Step 8: 自己レビューしてコミットする。** 変更ファイルだけ明示stage。公開API、red/green根拠、全試験件数、残る制限をtask reportへ記録。

### Task 2: 保管・料理の操作と表示、単体HTMLの検証脚本

**Files:**
- Create: `src/reform/FoodLogisticsPanel.tsx`, `tests/reform-housing-food-ui.test.ts`, `scripts/verify-food-logistics.mjs`
- Modify: `src/reform/FacilityAction.tsx`, `Life.tsx`, `HousingPanel.tsx`（必要な食材表示のみ）, `ReformApp.tsx`, 既存のreform用CSS、`package.json`

**Interfaces:**
- Consumes: Task 1の `FoodResult`, `FoodInspection`, `foodBundleStatus`, `createFoodBundle`, `assignFoodHaul`, `returnFoodBundle`, `inspectFoodHaul`, `inspectFoodReturn` と既存 `inspectOrder`／`order` の `{fixtureId,bundleId}`。
- Produces: `FoodLogisticsPanel({game,onGame}:{game:Game;onGame:(game:Game)=>Promise<boolean>|void})`。既存の保存成功／失敗の扱いを守る。
- Produces: 基本料理の材料選択、保存枠・人物ごとにリセットしタブ往復で維持する未確定選択。時刻や物資は選択イベントで変更しない。
- Produces: `npm run test:food-logistics`。最新 `dist/yohaku.html` だけを、ユーザー保存から分離したPlaywright contextで実操作する脚本。

- [ ] **Step 1: 利用者の判断を検証する表示テストを先に書く。** 一束がない／食材不足／供給口／運搬中／保管中／加工中／返却済みについて、自由食材と現物が区別でき、操作不能理由を読めることを確認する。単なるclass名や内部状態の写しを試験にしない。
- [ ] **Step 2: 「住まい」に保管パネルを実装する。** 部屋と床、担当者、取り分け、保管先へ運ぶ、担当を外す、供給口へ戻す／備蓄に戻すを接続。現在地・段階・担当・時間を表示し、操作後の保存失敗を成功表示にしない。床指定は無償で収納家具や冷蔵効果を表示しない。
- [ ] **Step 3: 「暮らし」の基本料理の材料選択を実装する。** 既定の共同備蓄を維持。一束選択時は設備の自動選択欄を「設備を選ぶ」にし、未選択の理由を示す。別担当／消費済み／ID違いの古い選択を勝手に共有備蓄へ切り替えない。上位料理と生活6用途は既存どおり。
- [ ] **Step 4: 材料取得を含む時間と安全取消を表示する。** 一束の所在地・取りに行く／運ぶ見込み・利用の分を明示。料理用運搬を木材や施工と呼ばない。次の完了・担当解除・待機理由の説明を本体と合わせる。
- [ ] **Step 5: 実操作脚本を追加する。** 通常開始から一束取り分け→保管→明示設備で料理→食事利用、途中リロード、別の束を運搬途中で取消→実返却を操作する。1280／390／320px、横はみ出し・主要ボタン・エラー・スクリーンショットを確認。境界入力を使う場合は通常開始と別のケースにする。脚本は既存browser helperを再利用し個人saveを取得しない。
- [ ] **Step 6: UIの意味あるテスト、全試験、ビルド、起動できる実操作経路を実行する。** 標準Chromium実体がない場合は起動不能の事実を報告し、rootが管理Chromeで最新HTMLの同じ操作を行う。静的表示テストを実試遊扱いしない。
- [ ] **Step 7: 自己レビューしてコミットする。** テスト根拠・脚本の実行／未実行・必要なroot確認をreportへ記す。

### Task 3: 比較・試遊の結果と次の判断を引き継ぐ

**Files:**
- Create: `docs/HOUSING_H6A_FOOD_LOGISTICS.md`
- Modify: `docs/DEVELOPMENT_HANDOFF.md`, `DESIGN.md`, `ROADMAP.md`, `PLAYTEST.md`, `GITHUB_WORKFLOW.md`, `CONTEXT7_DOCS7_WORKFLOW.md`（実際に変わった現在地のみ）

**Interfaces:**
- Consumes: rootが確定した比較要約、最終テスト・ビルド結果、通常開始／制御入力の区別、実際のブラウザ操作結果、最終HTMLのsize/hash。中間データのパスはdispatchで渡す。
- Produces: 前工程を履歴として保ち、採用した範囲と未実装・未検証を明示したboundedな文書差分。GitHub/Notion受領IDはrootの送信後報告へ残し、自分の未作成コミットIDを捏造しない。

- [ ] **Step 1: 根拠を照合する。** 設計、同条件比較、実画面、テストの値を確認し、矛盾や欠測はrootへ伝える。生ログ・詳細save・画像を公開文書へコピーしない。
- [ ] **Step 2: 結果文書を書く。** 一束の通常ループ、予約と取消、近方／遠方の保管・分担、操作の負担、参考作品から学んだ範囲、原作未検証、開発判断、実装と未完了の境界を記す。
- [ ] **Step 3: 現行仕様と入口を更新する。** H5aを保持し、H6aを今回の到達点にする。次の問いは実測で残った問題から選ぶ。古い全体ロードマップの履歴を勝手に完了へ変えない。
- [ ] **Step 4: 文章と差分を確認してコミットする。** リンク・時刻・数量・テスト数・ハッシュの誤記を直す。文書だけの変更に実装を写すテストは加えない。

## rootが実施する統合・引渡し

Task 2後、最新ビルドで実際の操作と見た目を確認し、対象範囲の問題を修正担当へ返す。同条件の料理と保管場所の比較を実測し、Task 3へ結果を渡す。全体レビュー後の製品修正は影響する試験と再ビルド・実操作を再確認する。最後にハッシュを固定し、単体HTML、GitHub一関連コミット、Notion新結果と入口の更新を実施・確認する。ユーザーの継続承認に基づき、この計画の各タスク間で再度の実行許可を求めない。
