# Housing H1-A Spatial Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 実位置・移動・到着・設備利用・運搬を同じ核で扱い、旧保存を変更せず空間の対応表へ読み取れるようにする。

**Architecture:** 局所マスと明示的な接続を共通の行程へ変換し、時間を進める関数だけで位置と行動を更新する。権利・予約・実占有・実位置を分ける。旧保存の投影は独立した読み取り処理とし、現行ゲームの進行・保存形式・画面はこの単位で切り替えない。

**Tech Stack:** TypeScript 5.9.3、Node.js v24.22.3、既存tsx 4.23.15とnode:test / node:assert/strict。新しい実行時依存を追加しない。

**Spec:** [2026-11-23-housing-h0-h1-design.md](../specs/2026-11-23-housing-h0-h1-design.md)。特に6章の共通規則と7章のH1-A固定契約を先に読む。

## Global Constraints

- 既存の`Game.version = 1`、`Library.format = 1`、書出し形式を変更しない。
- 空間の核の保存形式は、製品の新セーブを意味しない独立の`type: "housing-spatial-state"`、`version: 1`とする。
- 行程の選択は同じ入力で同じ結果になるよう、同距離なら安定したID順で決める。乱数は使わない。
- 時間進行は非負の整数で受け、照会・指示・取消だけでは時計を進めない。到着した瞬間に利用時間を既に経過した扱いにしない。
- 占有中の設備へ二重予約しない。予約者が取消すと未使用枠を一度だけ解放する。空間の核は資材を生成・消費しない。
- 外見・人物作成、既存ゲーム画面、現行の建築・在庫・社会効果はH1-Aでは切り替えない。これは最終形の制限ではなく、共通基盤を検証する実装境界である。
- 一分は今回の核の時間単位であり、完成形の刻み幅・人数・拠点数の上限を決めない。
- 本体の`src`から研究用`docs/research/.../spatial-probe.ts`をimportしない。試作は小条件の根拠であって本体へそのまま昇格させない。
- GitHub mainの最新HEADと差分を再確認し、無関係な変更を取り込まず、force pushしない。関連した成果はまとめて保存し、保存内容を読み戻す。Sites公開はこの計画に含めない。

## Review Focus

1. 道や許可が移動区間の途中で変わる入力：進入済み区間の残時間を消化し、次の進入で再評価する。瞬間転送・永久的な新規進入許可にしない。Task 2で固定する。
2. 予約後に運搬対象が動く・使用許可を失う入力：引取り時に対象と許可を再確認し、別の場所から引き寄せない。Task 2で固定する。
3. 完了直後や待機中に保存を挟む入力：再開で効果を再発火させず、表示・経過時間の分割で結果を変えない。Task 3で固定する。
4. 片側だけ壊れたgame/origin：片方だけの投影を成功として返さず、元の保存を変更しない。Task 4で固定する。
5. 不正な参照・運搬の循環・二重予約を含むJSON：一部だけ修復して読み進めず、説明できる失敗を返す。Task 3で固定する。

---

## 0. 実装境界とファイルの責務

この計画はH1全体ではなく、H1-Aの独立した核を作る。H1-Bで必要になる旧Taskの実行、社会効果との接続、現行UIでの指示、製品セーブの移行確定・競合解決は対象外。H1-Aの完了を新住居が遊べる状態と呼ばない。

| ファイル | 責務 |
| --- | --- |
| `src/reform/spatial/types.ts` | 空間、位置、行程、権利、予約、行動の型と共有の理由コード |
| `src/reform/spatial/route.ts` | 位置から目的地までの経路照会と、次区間の通過判定。状態を変更しない |
| `src/reform/spatial/actions.ts` | 指示・取消・時間進行・実位置の参照。位置と進捗を変える唯一の処理群 |
| `src/reform/spatial/codec.ts` | 独立形式の構造・参照・意味の検証、JSONの読書き |
| `src/reform/spatial/legacy.ts` | V1のgame/originを検証して複製し、旧位置・接続の読み取り用対応表を作る |
| `tests/fixtures/reform-spatial.ts` | 完全に架空の試験用小世界。利用者の個人セーブは使わない |
| `tests/reform-spatial-route.test.ts` | 経路と物理・許可の区別 |
| `tests/reform-spatial-actions.test.ts` | 到着、利用、運搬、予約、取消と変更の適用時点 |
| `tests/reform-spatial-save.test.ts` | 保存再開と不正データの拒否 |
| `tests/reform-spatial-legacy.test.ts` | 旧データの意味と非破壊性 |

既存ファイルの再編成や新ライブラリの導入を前提にしない。必要が生じた変更は実装理由と影響を記録する。

## 1. この単位で固定する公開契約

以下の名前をタスク間の受渡しに使う。関数内部の探索データ構造、補助関数、モジュール内の非公開型は実装担当が選んでよい。

```ts
type SpatialPoint = { domainId: string; cell: number };
type SpatialRef = { kind: "actor" | "item"; id: string };
type SpatialStep = {
  kind: "walk" | "connection";
  id: string;
  from: SpatialPoint;
  to: SpatialPoint;
  minutes: number;
};
type SpatialPosition =
  | { kind: "at"; point: SpatialPoint }
  | { kind: "transit"; step: SpatialStep; remaining: number }
  | { kind: "carried"; carrierId: string };
type SpatialIntent =
  | { kind: "move"; actorId: string; destination: SpatialPoint }
  | { kind: "use"; actorId: string; slotId: string; useMinutes: number }
  | { kind: "carry"; actorId: string; payload: SpatialRef; destination: SpatialPoint };
type SpatialReason =
  | "missing" | "physical-block" | "entry-denied" | "use-denied"
  | "handling-denied" | "reserved" | "actor-busy" | "payload-unavailable"
  | "occupied" | "invalid-input";
type SpatialEvent = {
  orderId: string;
  actorId: string;
  kind: "arrived" | "use-completed" | "picked-up" | "delivered" | "cancelled";
  atTime: number;
};
type SpatialTransition = { state: SpatialState; events: SpatialEvent[] };
```

`SpatialState`の保存する情報は以下に限定する。`type`と`version`は固定契約どおりとし、関数やDate、MapをJSONへ混ぜない。

- `time`：非負の安全な整数。`nextOrderId`：次の命令の通し番号。採番は明示的な指示受付時だけで、乱数・現在の実時間を使わない。
- `domains`：IDごとの幅・高さ・通行不能マス・`stepMinutes`。幅、高さ、stepMinutesは正の安全な整数、マス番号は0以上かつ幅×高さ未満。
- `connections`：ID、両端の`SpatialPoint`、正の`minutes`、`open`。別領域・階段・道路を同じ型で表す。今回の接続は双方向。
- `gates`：同じ領域の隣接する二点を区切るIDと`open`。隣接歩行の一辺を遮る。接続の開閉と同じ次区間判定へ渡す。同じ辺へ複数のgateは設定しない。
- `entryRules`：点と許可された人物IDの配列。規則がない点は通常通行可能、空配列は通常通行不可。複数規則を同一点へ置かない。複雑な地域法や役割継承は実装しない。
- `slots`：ID、利用地点、`allowedActorIds`（nullなら通常利用を制限しない）。1つのIDが1人分の枠を表す。
- `actors`：ID、`SpatialPosition`、進行中の行動またはnull。人物を運ぶ場合に必要な`carryAllowedActorIds`を持つ。これは引取りを許す試験条件で、全NPCの心理・同意制度ではない。
- `items`：ID、`SpatialPosition`、`carryAllowedActorIds`。大きさや向きのない運搬対象。物資会計や家具性能は持たない。
- `orders`相当の行動情報：命令ID、`SpatialIntent`、段階（接近・移動・利用・搬送・待機・`exiting-after-cancel`）、利用残時間、再開先、待機理由。carryでは受付時の引取り地点を`pickupPoint: SpatialPoint`として保存する。格納はactor内にまとめ、独立した写しを二重管理しない。
- `reservations`：対象種別（slotまたはpayload）・対象ID・命令ID・実行者ID。予約は実占有を意味しない。利用中も同じ予約を保持する。

全てのIDは空でない文字列とし、キーと内部IDを一致させる。`SpatialStep.kind = "walk"`の区間には入力の点から決定的に作ったIDを、`kind = "connection"`には明示接続のIDを使う。参照・通過判定・保存検証はkindとidの組を使う。異なる種別のIDが同じ文字でも取り違えない。予約キーや歩行IDの具体的な符号化は内部実装とし、文字列連結だけで同種別内の衝突を起こさない方法を使う。

H1-Aの人物運搬は、対象が自身、既に運搬中、点にいない、または進行中行動を持つ場合は受付時に`payload-unavailable`で拒否する。引取り時にも再確認し、対象が別の行動を始めた・保存したpickupPointから動いた場合は、元の引取り地点で待機する。対象を追跡せず、その仕事や予約を無言で消さない。運搬予約は対象人物の体を固定しないが、`carried`状態の人物自身をactorIdとする新規指示は`actor-busy`で拒否する。これは競合を避ける最小契約であり、救助や強制移動の全仕様ではない。

### 共通の小世界

試験用領域`home`は幅3・高さ2・全6マス通行可・一歩1分。入口0、廊下1、私室2、下側の迂回路3〜5。1と2の間に`private-door`、私室2の利用枠は`desk-seat`。通常最短は2分、戸口を閉じた場合の迂回は4分。部屋番号・一歩の時間・人数は試験値である。

領域`other`は幅2・高さ1とし、homeの0からotherの0へ3分の接続`road`、otherの1に置場を作る。`road`上の残り2分で保存する条件を用意する。試験用人物PとQ、物品Fを持ち、公開・入室不可・持出不可を独立に変えられる設定にする。

## Task 1: 空間と通行の共通契約

**Files:** Create `types.ts`、`route.ts`、`tests/fixtures/reform-spatial.ts`、`tests/reform-spatial-route.test.ts`（上記の完全なパス）。

**Interfaces:**

- Produces: `inspectSpatialRoute(state: SpatialState, actorId: string, from: SpatialPoint, to: SpatialPoint): SpatialRouteResult`。
- `SpatialRouteResult`は`physical: boolean`と、使用可能なら`{ok:true, steps:SpatialStep[], minutes:number}`、不可なら`{ok:false, reason:SpatialReason}`を持つ。物理経路が存在し入室規則で遮られる場合は`physical:true / entry-denied`。物理経路自体がない場合は`physical:false / physical-block`。複合原因を一つの道の不存在へ置き換えない。
- Produces: `canEnterSpatialStep(state: SpatialState, actorId: string, step: SpatialStep): {ok:true} | {ok:false;reason:SpatialReason}`。現在の地形、gate/connectionの状態、進入先の許可を検査する。

- [x] **失敗する試験を書く。** `shortest_route_is_two_minutes`で0→2の所要2、`closed_gate_uses_four_minute_detour`で戸口の辺を使わず所要4、`permission_is_not_a_wall`で物理到達可・entry-deniedを検査する。入力の深い写しと照会後が一致することを全ケースで確認する。
- [x] **最初の失敗を確認する。** `node --import tsx --test tests/reform-spatial-route.test.ts`。未実装の公開関数による失敗であり、挙動不良の証拠とは分けて記録する。
- [x] **型と経路照会を実装する。** 上下左右の隣接と明示接続を経路候補へまとめる。現時点で通れない辺を除外し、同距離の選択を安定させる。表示や階層だけから接続を生成しない。
- [x] **通過を確認する。** 上記コマンドがexit 0。`same_inputs_same_route`でオブジェクト挿入順が異なる同じ小世界も同じ経路を返す。
- [x] **区間種別の衝突を確認する。** `same_id_different_step_kind`で同じ文字のID・同じ両端・同じ時間の歩行と明示接続を置き、一方だけを閉鎖しても他方を誤って閉鎖しない。kindとidで進入条件を選ぶことを検査する。
- [x] **独立レビューと保存。** 規則のない点と空の許可配列の違い、所属と接続の分離を確認し、対応する型・実装・試験を同じ変更単位にする。

## Task 2: 到着・設備利用・運搬・取消

**Files:** Create `src/reform/spatial/actions.ts`、`tests/reform-spatial-actions.test.ts`。必要な状態型だけ`types.ts`へ追加する。

**Interfaces:**

- Consumes: Task 1の`SpatialState`、`SpatialIntent`、`SpatialStep`、経路照会と進入判定。
- Produces: `issueSpatialOrder(state: SpatialState, intent: SpatialIntent): {ok:true; state:SpatialState; orderId:string} | {ok:false; reason:SpatialReason}`。有効な指示だけ複製した状態へ予約を加える。不成立なら既存の仕事を消さない。
- Produces: `advanceSpatial(state: SpatialState, minutes: number): SpatialTransition`。負数・小数・安全でない整数は処理前にErrorで拒否する。
- Produces: `cancelSpatialOrder(state: SpatialState, actorId: string): SpatialTransition`。
- Produces: `locateSpatial(state: SpatialState, target: SpatialRef): SpatialPosition`。carriedを辿った最終の実位置を返し、循環はErrorにする。返す値を変更して入力へ漏れない。
- Produces: `setSpatialGate(state: SpatialState, gateId: string, open: boolean): SpatialState`、`setSpatialEntryRule(state: SpatialState, point: SpatialPoint, allowedActorIds: string[] | null): SpatialState`。nullは規則を除く。既存の接続開閉も`setSpatialConnection(state, connectionId, open): SpatialState`で行う。

- [x] **失敗する行動試験を書く。** `order_does_not_advance_or_arrive`で時計・位置が不変、`use_starts_after_arrival`で0から2へ2分到着→利用2分→時刻4でuse-completedが一度だけ出ることを確認。到着tickを利用の最初の1分へ二重計上しない。
- [x] **競合・変更・搬送の失敗試験を加える。** `slot_is_exclusive`で同じ枠の二人目はreserved。`permission_revoked_before_entry`では次区間へ入らない。`admitted_segment_finishes`ではroad進入後の閉鎖でも残り2分だけ進み、新たな進入は拒否。`pickup_requires_actual_colocation`ではPがFの地点へ到着するまでFの位置が不変。`handling_revoked_before_pickup`では予約があっても持ち出さない。
- [x] **運ばれる人物の競合を試験する。** `busy_patient_is_not_picked_up`でQの利用中の仕事と予約を保持して運搬を拒否する。`patient_starts_work_during_approach`で受付後に仕事を始めたQを引き取らない。`carried_actor_cannot_start_order`で運ばれるQ自身への指示を拒否し、所在を上書きしない。`moved_payload_waits_at_saved_pickup`で対象が移った際に保存した引取り地点で待つ。
- [x] **取消の失敗試験を書く。** 点にいる時はその点で停止し、運搬中の対象は同じ点へ置く。区間途中では保存される段階`exiting-after-cancel`へ移し、現在区間の終点まで退出する行動だけを残す。終点で対象を下ろして全予約を一度だけ解放し、`cancelled`だけを一度発行する。取消による退出を`arrived`・`delivered`・`use-completed`へ混ぜない。新しい目的地や遠い元の場所へ戻さない。取消直後は時刻不変、再取消は無変化。試験名は`cancel_mid_segment_finishes_only_that_segment`。
- [x] **失敗を確認する。** `node --import tsx --test tests/reform-spatial-actions.test.ts`。期待する未実装境界による失敗を記録する。
- [x] **指示・進行・取消を実装する。** 同じtick内では人物IDの安定順で処理する。到着前に利用効果・引取り・配達を出さない。対象の移動や許可取消は引取り直前にも確認する。区間途中での閉鎖要求は既に進入した者の退出を待つ扱いとする。
- [x] **通過と分割進行を確認する。** 上記コマンドとTask 1のコマンドがexit 0。`advance_partition_is_equivalent`で連続10分と3分＋7分の最終状態・連結イベントが一致する。途中の照会を挟んでも同じであることを含める。
- [x] **独立レビューと保存。** 残時間、予約解除、対象所在がそれぞれ一つの正本を持つか確認する。物資消費、会話、治療効果をこの核へ追加しない。

## Task 3: 保存・再開と不正入力の検証

**Files:** Create `src/reform/spatial/codec.ts`、`tests/reform-spatial-save.test.ts`。

**Interfaces:**

- Consumes: Task 1・2の全保存型。
- Produces: `parseSpatialState(json: string): SpatialState`。JSONの値をunknownとして検証し、不成立ならErrorで拒否する。返した後に元の入力オブジェクトを共有しない。
- Produces: `serializeSpatialState(state: SpatialState): string`。保存前にも同じ整合を確認する。
- Produces: `isSpatialState(value: unknown): value is SpatialState`。型の形だけでなく、参照・残時間・予約の整合も検査する。

- [x] **失敗する保存試験を書く。** `resume_on_road`で3分接続の残り2を往復して保持、`resume_carried_payload`で人物/物品の運搬参照と予約を保持、`resume_waiting`で許可待ちの再開、`completed_event_is_not_replayed`で完了後保存→再進行に同じ完了が出ないことを検査する。
- [x] **途中取消と区間の識別を保存試験する。** `resume_after_cancel_mid_segment`で運搬中の取消直後に保存し、現在区間の終点で停止・下ろし・予約解除・cancelled一回となることを確認する。再取消・再読込みで元の仕事を復活させない。`step_kind_survives_roundtrip`で同じ文字のIDの歩行と明示接続のkindが保持される。`pickup_point_survives_roundtrip`で対象が動いた後も元の引取り地点で待つ。
- [x] **不正入力の失敗試験を書く。** `reject_bad_version_or_refs`（未対応version、欠損domain/actor/slot、範囲外cell）、`reject_invalid_progress`（負の時刻、0以下の区間時間、区間総時間を超えるremaining、利用残時間不正）、`reject_duplicate_reservation`、`reject_carry_cycle`。正常な通行不能状態は受け入れる。
- [x] **失敗を確認する。** `node --import tsx --test tests/reform-spatial-save.test.ts`。
- [x] **codecを実装する。** 未知の外部データへ型assertionだけを当てず、全参照先を検査する。利用中の予約と行動、carried対象と運搬仕事の対応も検査する。先に一部を修復して保存する処理を入れない。
- [x] **通過を確認する。** Task 1〜3の3試験ファイルを同じコマンドへ渡してexit 0。再開後と未保存継続の状態・イベントが一致する。
- [x] **独立レビューと保存。** parserの通過が本体のV1セーブ移行成功を意味しないことを文書に残す。

## Task 4: 旧game/originの非破壊投影と統合前の確認

**Files:** Create `src/reform/spatial/legacy.ts`、`tests/reform-spatial-legacy.test.ts`。既存`src/reform/sim.ts`の`isGame`・型、`house.ts`の型、`library.ts`のSlot型は読む。これらの型・実行処理は変更しない。

**Interfaces:**

- Produces: `projectLegacyHousing(slot: unknown): LegacySlotProjection`。id/nameとgame/originを検証し、各Gameは既存`isGame`を使う。片方でも不正ならError。投影のために新しいSlot IDを採番しない。
- `LegacySlotProjection = { source: Slot; game: LegacySpatialView; origin: LegacySpatialView }`。sourceは入力全体の深い複製で、外見、キャラ作成、持物、予約、残時間、乱数等を保持する正本。viewは読み取り用の派生情報であり、ゲームを進める空間状態ではない。
- `LegacySpatialView`は旧Roomを変更せず参照するroom対応表、家具ID→旧room/cell、人物ID→旧location/room（`kind:"legacy-unspecified"`）、旧linksの両端入口0、旧来の部屋間移動単位3分を持つ。room IDを別の部屋名から再生成せず、旧doorsは室内マスの情報として保つ。
- source内に残る旧Taskを実行・再分解しない。`SpatialState`への変換やadvanceSpatialへの投入を行わない。

- [x] **旧データの失敗試験を書く。** `legacy_layout_is_not_rearranged`で部屋幅/壁/doors/fixtures/任意linksが一致。`legacy_positions_stay_unspecified`で入口へ勝手に配置されない。`legacy_work_is_preserved_without_recharge`で途中料理等のTask、予約量、在庫、rngが原値と一致する。
- [x] **開始時と現在の違いを試験する。** `game_and_origin_are_distinct`で異なる2状態を保持し、投影側を変更しても入力へ漏れない。`invalid_origin_rejects_all`でgame正常/origin破損が全体失敗、入力不変。標本は既存testの生成関数を使うか架空状態から生成し、利用者の実セーブを持ち込まない。
- [x] **失敗を確認する。** `node --import tsx --test tests/reform-spatial-legacy.test.ts`。
- [x] **読み取り投影を実装する。** 現行importSlotは新IDを発行するため、読取り専用の投影へ流用しない。旧Taskが新同席の証拠になるようなフィールドを捏造しない。
- [x] **限定試験と全体を確認する。** 新4試験、`npm test`、`npm run build`を実行する。本体の全テストはここで一度まとめて確認し、具体的な失敗がなければ繰り返さない。
- [x] **既存の配布物を回帰確認する。** AGENTS.mdの確認経路に従い、最終ビルドの`dist/yohaku.html`に対し`npm run test:standalone`と`npm run test:ui:standalone`を実行する。結果のHTML SHA-256と最終配布物が一致することを記録する。このUI確認は既存ゲームの回帰確認で、新しい住居画面の試遊でも実機スマホ確認でもない。
- [x] **最終レビュー、記録、GitHub保存。** この単位の実行結果と未実装範囲を記録し、設計・計画との差を直す。書込み直前のmainを確認し、既存履歴へ通常の子コミットとして保存して内容を読み戻す。現行仕様へは「空間核の追加」の範囲だけ反映する。


## 完了条件と次の段階

H1-Aの完了は、上記の核・投影・必要な試験・最終差分の検証が揃った時点。現在の画面で全ての新行動が動くという意味ではない。

H1-Bでは、最新の参考資料とコードを再確認した上で、現行Taskとの互換、到着を伴う新行動、共食・会話・手当て・救助、所在別在庫、画面への理由表示、旧保存から新しい継続への移行を別の具体的な計画にする。H2/H3ではその結果へ計画編集・搬入・施工を接続する。機能範囲を増やす時も、既存の外見設定と人物作成の選択肢を保存する。

## 計画の自己確認

作成時点で、設計7章のH1-A固定契約をTask 1〜4へ割り当てた。物理と許可はTask 1、到着・予約・運搬・取消はTask 2、保存・参照検証はTask 3、旧game/origin保持はTask 4が担当する。Review Focusの五項目は各タスクの明示した試験へ対応する。

作成時は全項目未着手。現在のチェック欄は本体用モジュールの実装・試験・独立レビューの結果を反映する。研究用試作36件の通過結果を、この計画のタスク完了へ繰り上げてはいない。実装中の判断は[H1-A判断記録](../../research/housing-h1a-2026-11-23/decisions.md)に残す。

独立レビューで、区間種別の識別、運搬対象人物の進行中仕事、途中取消の保存について計画上の不足が見つかった。公開契約とTask 1〜3の試験へ反映した。これらは実装済みの不具合を修正した記録ではない。

## 実施記録（2026-11-23）

Task 1〜4の本体用モジュールと個別レビューを完了。新規64件を含む全818件の試験とビルドが成功した。標準の単体HTMLの2スクリプトはChromium起動前のsocket拒否で開始できず、最終成果物と同一ハッシュの内部プレビューによる実操作を代替確認とする。標準スクリプトの成功とは扱わない。詳細な実行経路と限界は[検証記録](../../research/housing-h1a-2026-11-23/verification.md)、数値と識別値は[検証データ](../../research/housing-h1a-2026-11-23/validation.json)を参照する。

全体レビューで見つかった重要4件・軽微1件を一括修正し、修正範囲の独立再レビューは全5件対応済み。修正版に対して全818件とビルドを再確認した。確定したGitHubコミットと読戻しの結果は、Notionの27｜住居H0・H1のH1-A実装結果へ記録する。
