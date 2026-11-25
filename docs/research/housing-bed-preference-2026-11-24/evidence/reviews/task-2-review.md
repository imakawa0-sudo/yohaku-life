### Spec Compliance

- ✅ 仕様に適合。`25f4154..fb0345d` は依頼された9ファイルすべてを変更している。`package.json:14` は検証コマンドのみ追加し、`scripts/verify-reform.mjs:303,342` は既存の方針欄セレクター2箇所のみ更新している。
- ✅ `src/reform/Life.tsx:763,786` は既存の方針欄の仕事と食事備蓄の間に設定を配置する。`src/reform/BedPreferencePolicy.tsx:14–43` は住居のあるGameのみを対象とし、本人の所在に関係なく、住人IDとGameから現在値を読み、変更時に既存の保存経路を1回呼ぶ。
- ✅ `src/reform/FacilityAction.tsx:39–58,94–129` は実行先と移動・利用・合計を既存の予告から表示する。自動の休息は優先先と代替理由を示し、一回指定はその設備の予告か無効理由を示す。`src/reform/facilityLabel.ts:3–13` は移設前の部屋名・家具名・行列・同名の室順を維持している。
- ⚠️ 完成HTMLでの操作、描画、全ケース完走は未確認。コントローラーは通常操作・制御入力、1280・390・320px、書出し・読込・分岐、表示時刻、4タブ、既存画像を完成HTMLで確認する。`src/reform/life.css:13,23,606–622,819–823` の静的確認では、新規方針欄は14px／13pxと44px以上の操作高を継承する。
- ⚠️ Task 2の差分は保存形式・ランタイム・依存を変更していない。Game.versionとHousingRuntime.versionが1、ライブラリformatが2、React 19.3.1／TypeScript 5.9.3、旧保存・自主休息・他用途の契約が揃うかは全体レビューと統合検証の範囲。

### Strengths

- `src/reform/BedPreferencePolicy.tsx:26–43` はラベルと補足をセレクトに関連付け、ローカルの設定stateを増やしていない。更新先と一回指定のdraftが交差する懸念に対し、`src/reform/ReformApp.tsx:80–96,206–214,347–362` を確認した。既存の更新経路は現在枠のGameだけを置換し、一回指定は別のstateで管理している。
- `tests/reform-housing-bed-preference-ui.test.ts:99,124,135,161,181,208,229` は有効なGameを実際に描画し、選択肢の絞り込み、外出先と旧保存、同名部屋、住人・保存ごとの設定、既存予告との差、明示指定の無効理由を確認している。
- `scripts/verify-bed-preference.mjs:89–218,221–249,284–301,329–372,375–624,628–666` は検証済みの入力生成、独立ブラウザ領域、全Gameとoriginの書出し照合、3幅での操作、通常操作と制御入力を扱う。prepare-onlyと起動前の失敗をUI成功と区別する。既存UIとの接続リスクについて、`src/reform/HouseEditor.tsx:114–132,201–222`、`src/reform/HousingPanel.tsx:113–131,213–220`、`src/reform/ReformApp.tsx:251–275,489–505,520–526` の名前と遷移を確認した。

### Issues

#### Critical

- なし。

#### Important

- なし。

#### Minor

- `scripts/verify-bed-preference.mjs:414–422,596–604,615–619` の設定ブラウザ照合は、本体と同じ `setPreferredBed` を期待値の生成に使う。UIからの対象住人・設定値・現在枠への伝達とoriginは検証できるが、更新関数自身が他のGame項目を変える回帰にも同じ期待値が生じる。ブラウザ検証単体でもこの不変条件を保証するなら、設定表だけを除外した設定前後のGameを直接比較できる。Task 2の合格を妨げるものではない。
- `.superpowers/sdd/2026-11-24-housing-bed-preference/task-2-tsc.log:1` にnpmの環境設定 `http-proxy` の警告がある。TypeScriptの型エラーは報告されていない。

### Assessment

**Task quality:** Approved

**Reasoning:** 保存設定は既存の現在枠更新に接続し、休息予告は計画済みの設備だけを表示する。要件をカバーするSSR試験とブラウザ検証手順があり、完成HTMLでの実操作はコントローラーの検証に残る。
