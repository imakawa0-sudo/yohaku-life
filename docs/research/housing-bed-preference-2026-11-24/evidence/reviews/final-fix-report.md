# 優先寝床の最終レビュー修正

基準は `370814976c35e38cb9bb956d010728a60387f1c0`。`final-review.md` の軽微な指摘3件に対応した。

## 修正した箇所

| 指摘 | 変更ファイル | 修正内容 |
| --- | --- | --- |
| 比較スクリプトの入力契約 | `docs/research/housing-bed-preference-2026-11-24/compare-preferred-beds.sh`、同ディレクトリの `preference-comparison-notes.md` | 前段の比較が出力した21:33の保存JSONを第3引数に必須化した。`--help` は必須引数と生成手順を案内し、引数不足や読み取り可能な通常ファイルを指定していない場合は、出力先を作る前に終了する。資料の実行例と説明をこの契約にそろえた。 |
| マニフェストの対象版 | 同ディレクトリの `evidence/preference-comparison-manifest.json` と `preference-comparison-notes.md` | `coreSourceFileSha256` の30件をコア版 `25f41547697b80399f134f634094200a4148a785` に対応させた。採取時の作業ツリーにあったUI用 `facilityLabel.ts` の元のハッシュは `workingTreeUiFileObservation` に移し、実験の入力外であることを記録した。旧ラッパーを含む採取時の成果物ハッシュは `artifactFileSha256` に残し、その時点を説明した。 |
| 検証期待値の自己参照 | `scripts/verify-bed-preference.mjs` | 通常の二人の設定、移動中の設定変更、利用中の解除の4地点で、明示した設定表または解除後のプロパティの省略を照合する。直前の書出しを基準に、設定表以外の全Gameとoriginの全フィールドを直接比較する。 |

## 確認したコマンドと結果

- `node --check scripts/verify-bed-preference.mjs`、`bash -n docs/research/housing-bed-preference-2026-11-24/compare-preferred-beds.sh`、`git diff --check` は終了コード0、出力なし。
- ラッパーを `bash` で実行した。`--help` は終了コード0。第3引数の省略、存在しないファイル、ディレクトリ指定は終了コード2で、出力先は作成されなかった。通常ファイルの検証には仮のバンドル生成器を使い、空白を含むファイルパスの転送を確認した。

  ```text
  Usage: bash compare-preferred-beds.sh REPO_PATH OUTPUT_DIR PUBLIC_INPUT_SLOT_JSON
  OUTPUT_DIR must be outside REPO_PATH.
  PUBLIC_INPUT_SLOT_JSON is the generated-daily-after-night-slot.json from compare-shared-use.sh (see comparison.md).
  PUBLIC_INPUT_SLOT_JSON must be a readable file: /tmp/bed-preference-cli.TR0kvFKq/missing-slot.json
  PUBLIC_INPUT_SLOT_JSON must be a readable file: /tmp/bed-preference-cli.TR0kvFKq
  Valid input: all arguments forwarded, including the explicit input path containing a space.
  ```

- `python3 -` でマニフェストの変更前後を比較した。コア版のファイルは `git show` の各Git blobからSHA-256を算出。UIファイルは `git cat-file -e` でコア版に存在しないことと作業ツリーのハッシュを確認し、元の実験フィールドとラッパーの記録は基準コミットから照合した。終了コード0。

  ```text
  30/30 core paths match the recorded Git revision.
  1/1 UI observation matches the working tree and is absent from the recorded Git revision.
  All original experimental fields, hashes and historical wrapper bytes verified.
  ```

- `env BED_PREFERENCE_PREPARE_ONLY=1 PLAYTEST_OUTPUT=/tmp/yohaku-final-bed-preference-fixes npm run test:ui:bed-preference` は終了コード0。出力は `"status": "inputs-prepared"`、`"normal": []`、`"controlled": []`、`"screenshots": []`、`"errors": []`、`"manifest": "/tmp/yohaku-final-bed-preference-fixes/bed-preference-manifest.json"`。既存のnpm警告 `Unknown env config "http-proxy"` が出た。
- `node --input-type=module -` で `node:vm` から実スクリプトの `assertPreferenceChange` を呼び、生成済みの `active` 入力に対して設定表だけを更新した4例と、意図的に別の状態も変更した8例を照合した。終了コード0。

  ```text
  4/4 valid transitions accepted.
  8/8 mutations detected: map, clock, task, reservation, other Game fields, origin, origin map, empty map after clearing.
  ```

- `node --import tsx --test tests/reform-housing-bed-preference.test.ts tests/reform-housing-bed-preference-library.test.ts tests/reform-housing-bed-preference-ui.test.ts` は終了コード0。`tests 38`、`pass 38`、`fail 0`、`cancelled 0`、`skipped 0`、`todo 0`。先に試した `npm test -- --test-name-pattern 'preferred|preference'` は `tsx` が `Error: listen EPERM: operation not permitted /tmp/tsx-1000/17.pipe` で停止したため、上記のNode直接起動で対象3ファイルを実行した。

## 今回の検証範囲

比較ラッパー、採取記録、ブラウザー検証スクリプトの変更を対象にした。627分の実験は保存済みの観測値と再現記録を用いた。完成HTMLの操作はコントローラーの実ブラウザー受入の記録を参照する。この修正でChromiumの再起動、全試験の再実行、再ビルドは行っていない。上の保存照合の単独試験は、生成済みの制御入力に対する検証関数の結果である。
