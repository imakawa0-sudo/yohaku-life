# Task 2 実装・検証報告

`fb0345df8093997acdde83ac590695e1da41ad55` — `feat: show persistent bed policy and fallback previews`（親 `25f41547697b80399f134f634094200a4148a785`）。依頼の9ファイルのみコミット。`ReformApp`、シミュレーション、保存形式、依存関係への追加変更なし。

## UIと自己レビュー

- 一回指定で使用済みの家具ラベルを、そのまま `facilityLabel` に抽出した。実際の `Room` を渡し、部屋名・家具名・行列・同名の順番を同じ規則で組み立てる。
- 既存の「暮らしと備蓄の方針」で仕事と食事備蓄の間に寝床のセレクトを置いた。本人の所在から独立し、住居のあるGameで表示する。選択値は選択中のGameと人物IDから読む。操作は一度だけ `onGame(setPreferredBed(...))` を呼ぶ。説明は `aria-describedby` で関連付けた。通常本文の文字サイズと既存の44px操作領域を利用し、長いラベルでグリッドが広がらないようにした。
- 普通の休息でのみ既定表記を切り替える。Task 1の予告から実行先と時間を示し、優先先が使えない場合は共有ラベルと理由を表示する。一回指定は `inspectOrder` の結果を表示し、元の選択や無効理由を保つ。施設の撤去後に消失した一回指定の扱いも既存テストで確認した。
- 既存 `verify-reform.mjs` は2箇所のFold見出しだけを更新した。新規ブラウザスクリプトは通常プレイと各制御入力を独立したコンテキストで開く。書き出しはブラウザ外で既存の `importSlot` に通し、現在のGameとoriginの全体を照合する。タイムステップや予約の比較には公開のシミュレーション関数を使用する。
- 通常操作の対象は「木工の二人」、居間に寝床を設置、住人ごとの設定、時計と予約、5分進行、再読込、二種類の分岐、元の枠への復帰と書き出し・読込み。制御入力では同じ寝床を優先する二人、使えない通路、休息へ向かう途中の変更と利用中の解除を扱う。1280px・390px・320pxで同じ名称・座標の設備を両セレクトから選び、操作領域と横方向のはみ出しを検査する。

## RED

UIの実装前に `node --import tsx --test tests/reform-housing-bed-preference-ui.test.ts` を実行した。最初の実行でテスト側の既存家具名を確認し、`敷きむしろ` と `布張りの寝台` に訂正した上で、UI編集なしで再実行した。

```text
exit 1
ℹ tests 7
ℹ suites 0
ℹ pass 1
ℹ fail 6
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 686.618496
```

4件は `missing policy fold`、2件は優先設定時の自動項目のコピー不足で失敗した。一回指定の実行先と既存の無効理由を守る回帰テストは初めから成功した。実行の全文は `task-2-red.log`。

## GREEN

- `node --import tsx --test tests/reform-housing-bed-preference-ui.test.ts tests/reform-housing-facilities-ui.test.ts` — exit 0。14件成功、失敗0、所要772.735749ms。全文 `task-2-focused.log`。
- `npx tsc --noEmit` — exit 0、型エラー0。npmの環境設定 `http-proxy` に関する既知の警告のみ。全文 `task-2-tsc.log`。環境設定は変更していない。
- `node --import tsx --test tests/*.test.ts` — exit 0。1078件成功、失敗0、スキップ0、所要5095.376807ms。全文 `task-2-full.log`。
- `git diff --check`、`git diff --cached --check`、`node --check scripts/verify-bed-preference.mjs`、対象4 TypeScriptファイルと新スクリプトの `prettier --check` — すべて成功。
- `BED_PREFERENCE_PREPARE_ONLY=1 npm run test:ui:bed-preference` — exit 0。結果 `inputs-prepared`、`errors: []`。既存バリデーターでGameとoriginの両方を検証してから以下の3入力を書き出した。HTMLの読込み、ブラウザ起動、画面確認はこのモードに含まれない。

| `/tmp/yohaku-bed-preference-playtest/` 内のファイル | SHA-256 |
| --- | --- |
| `bed-preference-input-active.json` | `25c9c462c794b74840ea8c8d7a57cc43d42030f7a18176fbb4baf69a8285a5bb` |
| `bed-preference-input-competition.json` | `b397b3f452f5d95679933c35485b3e2aac469f372561a10f134ea9b5a9f12d25` |
| `bed-preference-input-inaccessible.json` | `f9d6f8b45e5953825f3eb538baa09d4e2b03ddc882078813ab79f695f9a07148` |
| `bed-preference-manifest.json` | `b89528b1827a7727018db127bee08fb469b05e7a4e189cf8422cc517d1e9b6a9` |

マニフェストには各入力ファイル、住人IDと表示名、設備ID・同名ラベル・slot ID、目的地、移動＋利用の合計、代替理由を含めた。競合・通路閉鎖では `mat-1` から `fixture-3` へ代替し、合計58分。優先時は `mat-1` で合計91分。進行中ケースは08:05から開始し、設定変更後も同じ寝床に着いてから解除できることを確認する手順。

## 残る確認

完成ブランチのビルド、実ブラウザの操作、スクリーンショットの目視はコントローラーの検証範囲。ローカルlauncherの試行や `dist/` への書込みは担当範囲では行っていない。スクリプトは起動前のエラーを `browser-infrastructure-failure-before-page-load` として結果に記録し、UIが実行済みとは報告しない。本担当の確認で未修正の実装上の問題は見つからなかった。
