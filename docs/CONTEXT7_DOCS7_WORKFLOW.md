# Context7・Docs7を使う開発手順

確認日：2026年11月26日（Asia/Taipei）。実サービスの設定と公式資料を照合した運用メモ。[最新の到達点](DEVELOPMENT_HANDOFF.md) と [GitHub保存手順](GITHUB_WORKFLOW.md) を併せて読む。

## 役割を分ける

| 場所・機能 | 確認すること |
| --- | --- |
| GitHub | 実装のコード、テスト、版ごとの技術資料、変更履歴。動作の根拠は実際の対象コミットを読む |
| Notion | 完成像、研究、採否の理由、ロードマップ、進捗、次に解く問い |
| Context7 | 関係資料を探す検索索引。見つけた記述の日付・対象版を確認し、最新mainと照合する |
| Docs7 | 文書の不足、PR内の記述、コード変更後の説明の不整合を調べる補助 |
| 開発担当 | 研究、設計、実装、コードレビュー、自動試験、実際の試遊、採用判断、保存確認 |

NotionとGitHubの自動同期は設定していない。Docs7の提案が、採用前のゲーム仕様や開発理念を自動的に確定することもない。実装結果とNotion記録を、同じコミットへ結び付ける。

## 確認した現在の設定

| 項目 | 設定・状態 |
| --- | --- |
| GitHub | `imakawa0-sudo/yohaku-life`、Public、`main` |
| Docs7資料の範囲 | 同リポジトリの `docs/` |
| GitHubアプリの接続 | `ok` |
| Context7ライブラリ | `/imakawa0-sudo/yohaku-life`、Public、索引有効 |
| 文書改善Agent | 週次（未処理の提案がある場合に実行） |
| PR Review Agent | 有効、Comment only |
| Code Watch Agent | 有効、同じリポジトリを監視 |
| Docs7 Hosting | OFF |
| Build Fix Agent | OFF |
| 利用プラン | Context7側はPro、Docs7側の実取得値はFree、`docs7ProEnabled=false` |

上記は既存設定の読み取り確認で、今回新たな課金や公開設定の変更はしていない。Docs7用URLが発行されていても、Hosting OFFの状態を文書サイト公開済みとは扱わない。APIで得られたプランと、過去の加入についての発言が食い違う場合は、どちらのサービスのプランかを区別する。

## Context7を使うとき

1. 最新mainのコミット、[開発引き継ぎ](DEVELOPMENT_HANDOFF.md)、Notionの現在地を先に確認する。
2. ライブラリIDを解決し、`/imakawa0-sudo/yohaku-life` を選ぶ。
3. 一回の検索は、優先寝床、料理設備の選択、保存互換性など一つの論点に絞る。
4. 検索結果の出典を開き、対象コミット、日付、旧版か改革版かを確かめる。資料が未保存・索引更新前の場合は、最新のコードと引き継ぎを直接読む。
5. 文書をGitHubへ保存した後、必要なときに索引を更新する。処理完了と、目的の資料が検索で返ることは別々に確認する。

この引き継ぎ開始時の索引更新は2026年11月25日03:41:37 UTCだった。料理設備指定の本体保存は同日04:02:19 UTCで、その資料一式は未送信だった。実際の検索でも、料理設備指定の最新資料ではなく、家具指定や優先寝床など以前の記録が返った。`complete` は索引処理が終わっている意味で、最新mainの全変更を反映した保証ではない。

現在地を尋ねる例：

```text
yohaku-lifeのDEVELOPMENT_HANDOFF.mdを根拠に、料理設備指定までの実装済み範囲と、未採用のH5a・H6を区別して説明してほしい。
```

技術APIを調べる際は、利用中のReact、TypeScriptなどを別ライブラリとして解決し、プロジェクトの依存バージョンに合う一次資料を確認する。

## Docs7が動く条件

### PR Review

公式資料では、文書変更を含むPRの作成や追加コミットが開始条件。Hosting OFFの場合は、最後の更新から5分後に開始する。`docs/` に変更のないPR、forkからのPR、エージェント自身のコミットは対象外。Comment onlyは指摘をコメントに残す方式で、ファイルを直接変更しない。[公式Agent説明](https://context7.com/docs/docs7/agent)

### Code Watch

選択したリポジトリの既定ブランチへPRがマージされると、変更コードと文書を比較し、必要な場合に文書修正PRを作る。文書修正が不要という結果でも、調べたPRは月間枠に数えられる。[公式Agent説明](https://context7.com/docs/docs7/agent)

### 週次の文書改善

Context7で見つかった未処理の改善提案がある場合に動く。週次設定だけで毎週必ず全コードを検査するものではなく、前の修正PRが開いたままなら次の処理を待つ。[公式Agent説明](https://context7.com/docs/docs7/agent)

### 直接mainへ保存した場合

PR ReviewとCode Watchの公式の開始条件はPRイベントであり、mainへの直接コミットだけを理由に実行済みと報告しない。今回の文書保存も、独立した内容確認と読戻しで検証する。Docs7の実施結果は、ActivityとGitHub上のコメント・PRで確認する。

今後、まとまった機能変更でこの2機能を使うなら、作業ブランチからPRを作り、コード・文書・必要な試験を確認してmainへ取り込む運用が候補になる。小さな修正ごとにPRを増やす義務は設けず、既存の保存手順と併せて変更単位を決める。自動マージは設定していない。

## 無料枠とHosting OFFの扱い

Docs7 Freeにはサイトごとの月間Agent実行枠があり、月初にリセットされ、上限を超えると次の月まで対象処理が止まる。2026年11月26日に確認した公式Agent・Plans本文には、具体的な月間回数の記載がなかった。確認できない件数を推測せず、実アカウントの使用状況と上限到達表示を確認する。Context7の検索枠とDocs7のAgent枠は混同しない。[公式料金・プラン](https://context7.com/docs/docs7/plans)・[公式Agent説明](https://context7.com/docs/docs7/agent)

Hosting OFFでも文書支援Agentを使える。Build healthとBuild FixはDocs7 hostingのビルドが必要で、Example CheckはDocs7 Pro向け。現在の文書支援の目的のために、Docs7サイト公開や `docs.json` 導入を追加する必要はない。[公式設定](https://context7.com/docs/docs7/configuration)・[公式Agent説明](https://context7.com/docs/docs7/agent)

## 一回の開発の終わりに残すもの

- 実装した範囲と、まだ提案・未実装の範囲。
- 保存済みコミット、実際に検証したHTML、試験結果と未確認範囲。
- 比較から選んだ理由と、次に解く問い。
- GitHubの読戻し結果、Notionの更新先、必要なら索引更新の結果。
- 詳細資料の送信が保留の場合、その範囲と、利用できる要約への入口。

設定済み、実行済み、検証済み、保存済み、公開済みはそれぞれ別の状態として報告する。
