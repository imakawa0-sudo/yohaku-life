# 実装前の公式資料確認

確認日：2026-11-24（Asia/Taipei）。新しい依存ライブラリーは導入しない。

## Reactの選択欄

Context7でReact公式資料 `/reactjs/react.dev` を解決し、親のアプリケーション状態に値を持つcontrolled selectについて確認した。参照先は [React公式のselect資料](https://react.dev/reference/react-dom/components/select)、取得元は [公式資料のソース](https://github.com/reactjs/react.dev/blob/main/src/content/reference/react-dom/components/select.md)。

選択値を親から `value` で渡す場合、`onChange` で対応する値を同期的に更新する。初期値だけを指定する `defaultValue` と役割が異なり、途中でcontrolled/uncontrolledを切り替えない。選択値は存在するoptionの値に対応させる。

本作では保存Gameが優先寝床の唯一の値を持ち、住人・保存切替時に別のローカルdraftを同期しない。設定欄のイベントが `setPreferredBed` と既存の `onGame` を通るようにする。一回指定用の未確定選択は従来の別機能として保つ。これはReactの資料を本作へ当てはめた設計判断である。

## 主担当による採用根拠の照合

調査担当の検索後、主担当もFirecrawlで次の公式ページを新しく取得し、対象箇所と日付／版を照合した。取得日は2026-11-24。全文の転載は行わず、`reference-check.md` の要約を根拠資料として保存する。

| 公式資料 | 主担当が照合した対象 | 判断に使う範囲 |
| --- | --- | --- |
| [The Sims 4・2026-10-27](https://www.ea.com/games/the-sims/the-sims-4/news/update-10-27-2026) | 睡眠中に別の行動を予約した場合の中断修正。PC1.129.39.1030/Mac1.129.39.1230/Console2.40 | 予約・設定の変更と現在の中断を別に扱う着想 |
| [The Sims 4・2026-05-12](https://www.ea.com/games/the-sims/the-sims-4/news/update-5-12-2026) | 二人に割り当てた寝床の名前表示、Scholarlyによる自主読書と予約の修正 | 割当を説明することと、直接指定を守る着想 |
| [Kenshi・旧パッチアーカイブ](https://lofigames.com/patch-notes/) | 0.96.5の負傷時の自主休息、0.96.18の寝床選択、0.98.26の同じ椅子への集中修正 | 自主選択と共有予約を検討する材料。公開2022-02-15、更新2022-02-22の古い資料 |
| [RimWorld・2024-05-24](https://ludeon.com/blog/2024/05/update-1-5-4104-released/) | 社交のくつろぎと座席予約、寝床不足の理由表示の修正 | 共有設備にも予約規則と失敗理由が必要という材料。1年以上前の資料 |

古い修正記録は現在版の完全な挙動を保証しない。参考作品の優先・所有・待機の仕様を推測して輸入せず、実測した本作の問題と照らして「非排他的な優先寝床」を選んだ。
