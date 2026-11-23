# 余白の暮らし：小サイズ人物PNG 16枚

2026年11月23日。

- `native/`：胸像14枚（48×56px）、全身2枚（26×60px）。透明PNG。
- `native-review-4x.png`：16枚を4倍に拡大した確認一覧。
- `native-inventory.json`：元画像・出力画像の寸法、切出し範囲、SHA-256、変換手順。
- AとGは同一画像のため、独立した絵は15種類です。

このZIPは原画を直接縮小した参照画像です。ゲーム本体では、原画由来の顔・髪・服の部品と小さいドットの特徴を合成し、10項目・41値を自由に選べます。16種類の固定画像だけに制限されません。

ゲーム中の合成例は `runtime-options-review.png` と `runtime-combinations-review.png` で確認できます。

原画と実装、再生成スクリプト、検証記録の保存先：
https://github.com/imakawa0-sudo/yohaku-life/tree/main/docs/design/character-runtime-20261123

PNGの拡大表示では「nearest / 最近傍」またはCSSの `image-rendering: pixelated` を使うと、ドットをぼかさず表示できます。原画PNGは変更していません。
