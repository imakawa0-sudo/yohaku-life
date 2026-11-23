# 住居H0・H1の調査・比較・設計検証

調査日：2026-11-23（台湾時間）。対象コード：`f6e762b21fb717fabe1f5c2d0b895b1e058c865c`。

## 成果の入口

- [設計書](../../superpowers/specs/2026-11-23-housing-h0-h1-design.md)：研究からの判断、空間三構成、同じ五行動での比較、旧保存と次の実装境界。
- [H0・六つの暮らし方](h0-scenarios.md)：六場面・18案。目的、人物、資源、関係、選択、想定結果、次にしたいこと。
- [現行コードの分析](code-analysis.md)：現在の部屋、扉、途中行動、在庫、game/originと、変更時の受入例。
- [H1-A実装計画](../../superpowers/plans/2026-11-23-housing-h1a-spatial-core.md)：次の空間核を作る四つの作業。未実装の計画。
- [検証記録](verification.md)：研究用試作36件、限定した型確認、レビューと確認範囲。
- [出典の詳細](sources.json)：公開日・版・取得範囲・確認できないことを記録した一次資料10件。

## 調査した一次資料

| ID | 資料 | 時点・対象 | 確認範囲と限界 |
| --- | --- | --- | --- |
| L1 | [EA：For Rentの住戸・賃貸](https://help.ea.com/en/articles/the-sims/the-sims-4/for-rent-residential-rentals-guide/) | 取得時は7か月前更新。正確な日付未確認。追加パック | 部屋の住戸/共有割当、住戸別情報、家主の管理。遠隔地の更新精度・通路計算の内部仕様は未確認 |
| L2 | [EA：Businesses & Hobbiesの事業](https://help.ea.com/en/articles/the-sims/the-sims-4/how-to-set-up-a-small-business/) | 取得時は7か月前更新。正確な日付未確認。追加パック | 自宅等での事業、居住/公開/従業員区分、到着後の仕事。細かな行程・予約の内部処理は未確認 |
| L3 | [EA：Bug Bash and Maker Packs](https://www.ea.com/games/the-sims/the-sims-4/news/update-3-17-2026) | 2026-03-17。PC 1.122.205.1030 / Mac 1.122.205.1230 | 好み等に応じた一部の自律利用と反復抑制、会話対象の調整。この版以後の全仕様を保証しない |
| L4 | [EA：物体の回転](https://help.ea.com/en/articles/the-sims/the-sims-4/how-to-rotate-sims-4/) | 公開・更新日未確認。関連箇所を取得 | PC/Macの自由回転と重ね置き。原作の経路方式、重ね置き後の利用可能性を示す根拠ではない |
| R1 | [Lo-Fi Games：Patch Note Archive](https://lofigames.com/patch-notes/) | アーカイブ2022-02-15公開、02-22更新。対象0.30.0 / 0.95.15 / 0.95.30 / 0.98.48。古い資料 | 有料寝床、野営用寝床、別の町の所有建物での食料、町変化と所有建物の保持。個別パッチの原公開日は未確定。現行回復倍率等は不採用 |
| R2 | [Ludeon：Odysseyと1.6の告知](https://ludeon.com/blog/2025/06/announcing-odyssey-and-update-1-6/) | 2025-06-11。1年以上前の発売前紹介 | 無料更新1.6部分のキャンプ、緊急出発、部屋・計画の改善。正確な期間・効率式は未確認 |
| R3 | [Ludeon：Odyssey preview #2](https://ludeon.com/blog/2025/06/odyssey-preview-2-gravships-and-space/) | 2025-06-27。1年以上前の追加パック発売前紹介 | 移動する生活拠点と、定住して小型輸送手段だけ使う選択。現行の容量・燃料式・無人維持は未確認 |
| R4 | [Ludeon：Update 1.6.4850](https://ludeon.com/blog/2026/06/update-1-6-4850-released/) | 2026-06-08。本体と追加パックの修正が混在 | 移動前の電力接続、deathrest、輸送中の人物消失等の修正。全ての作業が移動後も継続するという一般化はしない |
| R5 | [Ludeon：Waylith Engineと1.7の告知](https://ludeon.com/blog/2026/10/announcing-the-waylith-engine-and-update-1-7/) | 2026-10-12の記事時点の1.7テスト版告知 | 実行基盤と遊び方・見た目の区別。11月23日の全配布ブランチの最新番号は確認していない |
| V1 | [Evans / Short：Versu原著論文](https://cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf) | 2013-10-25公開、2014-06-12版。古い設計資料 | 場面が選択肢を提供し人物が選ぶ構成、役割、テキストによる状態表現。本作規模の性能、Sims 4固有の仕様の根拠ではない |

補助の所在確認：[Versu公式・How Versu Works](https://versu.com/about/how-versu-works/)。研究内容の根拠は原著論文を優先した。

Firecrawlを優先し、利用枠不足後は未取得箇所をParallelで取得した。重要な新しい記述はEA・Ludeon・Lo-Fi Gamesの公式ページと論文で再照合した。Ludeon更新ページの直接取得が403になった経路では、同じ公式URLの検索取得で本文を確認した。取得時刻が新しいことと、資料の記述が最新仕様を全て保証することは区別している。

## 本作へ渡す研究上の結論

以下は本作の設計判断であり、三作品の内部実装の説明ではない。

1. **住まい方ごとに違うものが蓄積する。** 土地や設備に加え、常連、作品、仲間との習慣、地域の信用、旅の記録、居心地のよい場所を成果として扱う。借室や移動生活を大きな持家までの仮段階にしない。
2. **建物の形だけで生活を決めない。** 所属、居住、所有、利用許可、指示権、予約と実占有を分ける。野営地は建物を持たなくてよく、同じ建物でも共有と私的な領域を組み合わせられる。
3. **行き先を実在の位置にしない。** 仕事の受諾、移動、到着、設備利用を分け、会話・運搬・救助の前提へ同じ実位置を使う。
4. **場所の変化を継続する世界に反映する。** 人物や物のIDを保持し、移動した後の供給は新しい所在で見直す。表示を要約するために、物資や人物を複製しない。
5. **使えることと、やりたいことを分ける。** 行動候補を場所・設備・役割から作る一方、人物の好み、約束、相手との関係、直前の経験は別の判断材料とする。自律行動の全モデルは後続で調査する。

## Context7で照合した技術資料

| 対象 | 実際に用いた原典 | 使い方と限界 |
| --- | --- | --- |
| TypeScript 5.9.3 | [判別可能な型の公式検証例](https://github.com/microsoft/typescript/blob/v5.9.3/tests/baselines/reference/discriminatedUnionTypes1.errors.txt)、[型述語の公式検証例](https://github.com/microsoft/typescript/blob/v5.9.3/tests/baselines/reference/inferTypePredicates.errors.txt) | 行動段階の分岐と処理漏れ、unknown入力の検証を整理。コンパイラの検証例は製品用セーブパーサではない |
| Node.js v24系 | [公式テスト文書を含むAPI](https://nodejs.org/docs/latest-v24.x/api/all.html)、[assert](https://nodejs.org/docs/latest-v24.x/api/assert.html) | 既存node:test、厳密な比較、失敗時の終了コード。実行環境はv24.22.3だが取得文書はv24系の現行文書 |

Context7は使用版の技術根拠を確かめるために使い、ゲームの面白さの採点には使わない。Superpowersは比較設計、実装単位への分割、独立レビュー、実行根拠の記録に使った。取得した資料に基づく新規依存の追加や更新は行っていない。

## 研究用試作の範囲

`spatial-probe.ts`と`spatial-probe.test.ts`はゲームから独立している。Aは場所と接続、Bは道路を含む連続マス、Cは局所マスと6分の道路接続を用意する。全案で同じ対象を別拠点へ運ぶ全行程は試験入力として10分。各案の途中表現は異なる。

検証対象は、計画と実位置、経路変更、許可、引取り、搬送、途中保存の共通条件。材料消費、設備利用の開始と完了、会話、建築工程、寸法や回転、旧保存移行、実画面の操作性はまだ実装していない。材木数が計画で変わらない試験を、施工の材料会計を検証した結果にはしない。

三案は共通の実行規則へ接続しているため、通過件数は構成の優劣を示さない。実際に確認できたのは、この小設定を共通契約で扱えること。Cの優先検証は設計分析からの判断で、性能・面白さ・操作性は後続の比較が必要である。
