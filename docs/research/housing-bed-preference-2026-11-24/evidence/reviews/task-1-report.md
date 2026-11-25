# Task 1 — 住人ごとの優先寝床の保存と休息計画

**状態** `DONE`  
**ベース** `2ee6af33defd06d02022a557a928bbd726b3d976`  
**コミット** `25f41547697b80399f134f634094200a4148a785` (`feat: persist resident bed preferences for ordinary rest`)

## 実装

- `src/reform/housing/bedPreference.ts` に指定された取得・更新・検証・家具編集時の整理を実装。住人と家に実在する `mat` / `bed` を照合し、辞書はown keyで読む。設定変更はGameとHousingRuntimeおよび設定辞書を新しく組み立てる。最後の項目を解除すると `preferredBeds` がなくなり、同じ値や不正な指定では元のGameを返す。
- `src/reform/housing/types.ts` に省略可能な `HousingRuntime.preferredBeds` と `HousingUsePreview.bedPreference` を追加。後者の `fixtureId` は設定された優先先で、外側の `facility.fixtureId` は実際の利用先。
- `src/reform/housing/bridge.ts` の共通計画で、家の普通の休息と自主休息に優先寝床を適用。予約、到達、入室、利用許可をすべて通った候補を優先し、代替は従来の時間・slot ID順と既存理由に従う。メタデータは予告へ渡り、Taskに保存されない。
- `src/reform/housing/runtime.ts` で保存の辞書を検証し、受理される間取り編集の複製でのみ消えた寝床を整理。既存の予約による編集拒否と、保存読込みでの不正データの拒否を維持。
- `tests/reform-housing-bed-preference.test.ts` と `tests/reform-housing-bed-preference-library.test.ts` に31件追加。移動・睡眠・食事・外出中の更新、プレビューの純粋性、明示指示、競合、経路・許可、取消・完了、低活力と夜の自主休息、家具編集、保存と分岐をカバーする。破損した手帳の保護は別プロセスのNode標準 `localStorage` を使った。テスト対象へのモックやフックの追加はない。

## RED・GREENの記録

| 段階 | コマンド | 終了コード | Node test出力 |
| --- | --- | --- | --- |
| 設定・計画 RED | `node --import tsx --test tests/reform-housing-bed-preference.test.ts` | 1 | `tests 6`, `pass 2`, `fail 4`, `duration_ms 302.920509` |
| 設定・計画 GREEN | 同上 | 0 | `tests 6`, `pass 6`, `fail 0`, `duration_ms 306.231507` |
| 家編集 RED | 同上 | 1 | `tests 18`, `pass 16`, `fail 2`, `duration_ms 363.242416` |
| 家編集 GREEN | 同上 | 0 | `tests 18`, `pass 18`, `fail 0`, `duration_ms 325.978845` |
| 保存検証 RED | `node --import tsx --test tests/reform-housing-bed-preference-library.test.ts` | 1 | `tests 13`, `pass 4`, `fail 9`, `duration_ms 512.667801` |
| 最終の対象テスト GREEN | `node --import tsx --test tests/reform-housing-bed-preference.test.ts tests/reform-housing-bed-preference-library.test.ts` | 0 | `tests 31`, `pass 31`, `fail 0`, `duration_ms 395.223374` |
| 全体 GREEN | `node --import tsx --test tests/*.test.ts` | 0 | `tests 1071`, `pass 1071`, `fail 0`, `duration_ms 5413.216323` |

すべての上記Node試験で `suites 0`, `cancelled 0`, `skipped 0`, `todo 0`。Nodeは `v24.22.3`。

- 設定・計画 REDでは、従来の `fixture-1`（寝台、58分）が返り、期待値の `mat-1`（むしろ、91分、`outcome: "preferred"`）と一致しなかった。設定・解除、外出中の設定、不正または同値で元のGameを返す3件は、設定API未実装を `AssertionError [ERR_ASSERTION]: The resident bed preference API is missing` として検出した。初回の準備試行で比較対象にnull-prototype辞書と `structuredClone` 後の辞書が混在していたため、両側を揃えて再実行した。表にはその修正後のREDを記録した。
- 家編集 REDでは家具の部屋間移動と未使用寝床の撤去が `進行中の指示が参照する部屋や地点は変更できません。` で失敗した。競合、予約解除、通路と利用許可、自主休息、使用中の撤去拒否は通過。住居runtimeの許可フィールドと編集時整理をつないで両件が通過した。
- 保存 REDでは住居runtimeにフィールドを許可し、内容をまだ検証していない段階で、未知の住人、未知の `__proto__` 自身のキー、用途違い、消えた寝床、数値、配列、null、独自prototypeが `actual: true, expected: false` で失敗。壊れた保存の実ストレージ試験では `readLocal().blocked` が `actual: false, expected: true` で失敗した。内容検証を接続して全件が通過した。
- `npx tsc --noEmit` は終了コード0。唯一の出力は `npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.` で、TypeScript診断はなかった。
- `git diff --check` と `git diff --cached --check` は終了コード0、出力なし。新規3ファイルについて `node_modules/.bin/prettier --check` は終了コード0で `All matched files use Prettier code style!`。

## セルフレビューと引き継ぎ

- 変更はコミット内の指定6ファイルに限定。優先寝床の判定は普通の活力休息の自動選択に限り、怪我の回復、外出中の休息、他の欲求、一回の明示指定には影響しない。候補なしの既存エラー優先順位も維持する。
- メタデータの参照先と実際の予約先をテストで照合した。設定操作が既存の予約や進行状態を引き継ぐことを、設定フィールド以外のGame全体で比較した。
- ランタイムや保存形式の版は既存値のまま。旧方式と住居方式の未設定保存を再読込みし、元と同じ内容を同じ形式で書き出せることを確認した。新規の設定フィールドを古い実行物が扱える保証はない。
- Task 1の検証に残る不具合はない。統合ビルド、ブラウザーでの操作、GitHub、Notionは親タスクで扱うため、このコミットでは実施していない。
