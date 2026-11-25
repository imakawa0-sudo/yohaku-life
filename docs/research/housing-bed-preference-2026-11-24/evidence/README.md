# 証拠の索引

生の個人セーブとブラウザの保存原文は収録せず、比較用に生成した状態の集計、検証項目、ハッシュ、実画面、実行ログを保存する。JSONの実行環境パスは当時の採取位置であり、外部へのリンクではない。

## 本体の比較

- [実装前のA/B/Cと一日の集計](comparison-baseline.json)
- [生成状態のハッシュ](generated-state-manifest.json)
- [未設定の実装前後の一致](baseline-equivalence.json)
- [優先設定の有無と予約競合の集計](preference-comparison.json)
- [コア版と採取時UIファイルを区別したマニフェスト](preference-comparison-manifest.json)
- [同じ21:33の状態からの再現結果](preference-reproduction.json)

## 完成HTMLの受入

- [HTMLの3経路の同一性](html-match.json)
- [26実書出し＋3生成入力、25項目の独立照合](managed-export-validation.json)
- [表示幅・ログ・画像の集計とハッシュ](managed-layout-and-logs-summary.json)
- [検証担当の要約](managed-evidence-summary.md)
- [制御入力と家具・表示の一覧](bed-preference-manifest.json)
- [320px測定](layout-320.json) ／ [390px測定](layout-390.json) ／ [1280px測定](layout-1280.json)

| 幅 | 休息と代替理由 | 優先する寝床の方針 |
| --- | --- | --- |
| 320px | [画像](rest-320.jpg) | [画像](policy-320.jpg) |
| 390px | [画像](rest-390.jpg) | [画像](policy-390.jpg) |
| 1280px | [画像](rest-1280.jpg) | [画像](policy-1280.jpg) |

画面幅を変える検証用iframe内の実画面。画面外の灰色部分は検証ページで、ゲームの表示ではない。スマートフォン実機の撮影とは区別する。

## 試験・レビュー

- [全1,078件](logs/final-suite.log) ／ [ビルド](logs/build.log) ／ [npm起動制約](logs/npm-test.log)
- [標準PC](logs/standard-pc.log) ／ [標準モバイル](logs/standard-mobile.log) ／ [寝床脚本](logs/standard-bed-preference.log)の起動前制約
- [本体の報告](reviews/task-1-report.md) ／ [レビュー](reviews/task-1-review.md)
- [UIの報告](reviews/task-2-report.md) ／ [レビュー](reviews/task-2-review.md)
- [全体レビュー](reviews/final-review.md) ／ [最終修正](reviews/final-fix-report.md) ／ [一回の再レビュー](reviews/final-fix-review.md)
- [進行記録と全判断](sdd-progress.md)

操作と未確認範囲は[検証記録](../verification.md)、外部保存の確認は[引渡し記録](../delivery.md)にまとめる。
