# 証拠と再現の索引

[検証の本文](../verification.md)に対象HTMLの違いと限界を記す。生の利用者保存とブラウザーの保存領域全体は含めない。

| ファイル | 内容 |
| --- | --- |
| [comparison-baseline.json](comparison-baseline.json) | 変更前の同じ朝からの投資比較。生成した状態の結果 |
| [auto-comparison-after-core.json](auto-comparison-after-core.json) | 本体変更後、追加の予告情報以外は全項目一致した比較 |
| [final-suite.log](final-suite.log) ／ [final-build.log](final-build.log) | 最終c3d1cbeの全1,040件成功と型検査・単体HTML生成 |
| [final-identity-red.log](final-identity-red.log) | 同じ部屋の同種家具と同名部屋の識別で期待した2失敗 |
| [standard-pc-launch.log](standard-pc-launch.log) ／ [standard-mobile-launch.log](standard-mobile-launch.log) ／ [standard-room-use-launch.log](standard-room-use-launch.log) | 最初のUI候補での標準Chromium起動失敗。画面の合格ではない |
| [browser-replay-results.json](browser-replay-results.json) | 実書出し31件のGame・origin全体一致、8組の全バイト一致。各書出しのHTMLハッシュを含む |
| [browser-observations.json](browser-observations.json) | 元の選択保存・旧キー、表示寸法、取得コンソールの集計 |
| [browser-operations.json](browser-operations.json) | 上の照合に使った公開関数の操作列。ファイル名は相対名で、生の書出しは添付しない |
| [final-html.json](final-html.json) | 702,433 bytesの最終HTMLの識別子 |
| [fixture-reproduction.json](fixture-reproduction.json) | 公開する生成用コードから作った4入力が、実操作へ読み込んだ入力と全バイト一致した結果 |

## 最終HTMLの画面

- [PCの家具選択](final-choice-desktop.jpg)
- [1280pxの表示枠](final-choice-1280.jpg)
- [390pxの移動・利用予告](final-choice-390.jpg)
- [320pxの予約済み表示](final-busy-320.jpg)
- [320pxの同名部屋の識別](final-duplicate-320.jpg)

[撤去後の画面](prior-removal-desktop.jpg)は52da590…の前候補。最終版でも撤去後の消失表示と無効化を実操作し、書出し `duplicate-removed` を照合したが、この画像を最終版の撮影とは扱わない。

## 再現

本体比較は `bash docs/research/housing-room-use-2026-11-24/compare-room-use.sh OUTPUT_DIR`。単体HTMLの自動操作はビルド後に `npm run test:room-use`。後者はブラウザーを起動できる環境で実行する。

`make-fixtures.sh OUTPUT_DIR` は公開関数から制御保存を作る。`verify-browser.ts` は引数の操作マニフェストに沿ってGameとoriginを比較する補助コード。実際の書出しを取り直す場合は通常の画面から取得し、そのファイル名・実際の操作列を指定する。画像やハッシュだけを再現の代わりにしない。

公開用に相対パスへ整えた生成コードを実行し、読書・食事・保存枠切替・同名部屋の4入力が、実操作で読み込んだ入力と全バイト一致することを確認した。ここへ生の個人保存を追加するものではない。
