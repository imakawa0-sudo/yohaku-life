### Spec Compliance

- ✅ Spec compliant. Task 1の指定6ファイルすべてに対応する変更がある。通常休息への適用、明示指示の優先、保存検証、間取り編集の整合について仕様に合致する。根拠は `src/reform/housing/bedPreference.ts:28`、`src/reform/housing/bridge.ts:276`、`src/reform/housing/runtime.ts:368`、`src/reform/housing/runtime.ts:657`。
- ⚠️ 単体HTMLでの統合操作はこのタスクの差分では確認できない。親の統合試験で確認する項目として引き継がれている（`task-1-report.md:40`）。

### Strengths

- `src/reform/housing/bedPreference.ts:22`、`:41`、`:56` — 取得・更新・検証を一か所にまとめた。継承した名前を設定値として読まず、変更時は必要な階層だけを複製する。最後の解除でフィールドが消える。
- `src/reform/housing/bridge.ts:276`、`:300`、`:325`、`:362` — 予約・経路・使用許可を順に確認した候補だけを優先順位に入れる。代替と未設定では従来の合計分数・slot ID順を守り、優先先と実際の利用先を予告で別々に扱う。
- `src/reform/housing/runtime.ts:657`、`tests/reform-housing-bed-preference.test.ts:436` — 編集の競合判定後に候補状態から参照切れを取り除く。予約中の家具を撤去した場合には元のGame全体を保つことを検査している。
- `tests/reform-housing-bed-preference-library.test.ts:103`、`:136`、`:224` — 現在・最初の朝が異なる設定を持つ状態で分岐を確認し、破損した参照がどちらのスナップショットでも拒否されること、失敗時に元の保存内容が守られることを確認している。

### Issues

#### Critical

- なし。

#### Important

- なし。

#### Minor

- `task-1-report.md:32` — 型検査は成功したが、npmが検証環境の `http-proxy` 設定への警告を出している。検証環境側で設定を見直すか、既存のローカルTypeScript実行ファイルを直接呼べば、型診断と環境の警告を区別できる。

### Focused checks

- 破損した家を寝床の検証が先に走査する懸念について、`src/reform/sim.ts:1839` と `:2010` で、家の形式確認が住居ランタイムの検証より前であることを確認した。
- 保存試験で追加したNode起動フラグと開発環境について、`README.md:128` にはNode 22.12以上を推奨するとある。試験実績は `task-1-report.md:27` にあるNode 24.22.3。22.12での起動はこのレビューでは検証していない。
- 型検査が参照だけの空プロジェクトを通ってしまう懸念について、`tsconfig.json:15`、`:18` で本体のsrcがstrict検査の対象であることを確認した。試験は再実行していない。

### Assessment

**Task quality** Approved. 設定操作、候補の選択、保存検証がそれぞれ既存の処理に接続されており、Task 1の受け入れを妨げる指摘はない。報告された対象試験は31件、全体試験は1,071件が成功した（`task-1-report.md:24`、`:25`）。
