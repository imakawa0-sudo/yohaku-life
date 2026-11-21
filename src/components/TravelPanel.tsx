import { useEffect, useState } from "react";
import { Backpack, ChevronDown, Moon, Package } from "lucide-react";
import { command, COIN_WEIGHT, getWalletCoins, inspectCoinTransfer, LOCATIONS } from "../game/engine";
import { freeBaseResources, getCarryLoad, isBaseLocation, ownFreeResources } from "../game/inventory";
import { inspectSleep } from "../game/overnight";
import type { Command, GameState, Resident, Resources } from "../game/types";
import { CoinTransferHistory } from "./CoinTransferHistory";

const RESOURCES = [
  ["food", "食事", "食"], ["ingredients", "食材", "個"],
  ["medicine", "手当用品", "個"], ["scrap", "資材", "個"],
] as const;
const empty = (): Resources => ({ food: 0, ingredients: 0, medicine: 0, scrap: 0 });
const number = (n: number) => Number(n.toFixed(1)).toString();

function CoinTransferControls({ game, actor, peer, canAct, onCommand, onFeedback }: {
  game: GameState; actor: Resident; peer: Resident; canAct: boolean;
  onCommand: (cmd: Command) => boolean; onFeedback: (text: string) => void;
}) {
  const [amount, setAmount] = useState(1);
  const validAmount = Number.isSafeInteger(amount) && amount > 0;
  function direction(from: Resident, to: Resident, kind: "give" | "take") {
    const cmd: Command = { type: "transfer-coins", residentId: actor.id, from: from.id, to: to.id, amount };
    const preview = inspectCoinTransfer(game, actor.id, from.id, to.id, amount);
    const error = !canAct ? "受渡しをする人を住民一覧で一人だけ選んでください。"
      : !validAmount ? "銀貨の枚数は1以上の整数で指定してください。" : preview.error;
    const label = kind === "give" ? `${peer.name}へ渡す` : `${peer.name}から受け取る`;
    const accessibleName = kind === "give"
      ? `${validAmount ? `銀貨${amount}枚を` : "銀貨を"}${peer.name}へ渡す`
      : `${peer.name}から${validAmount ? `銀貨${amount}枚を` : "銀貨を"}受け取る`;
    return <div className="travel-transfer coin-transfer-action" data-direction={kind}>
      <button type="button" data-coin-transfer={kind} aria-label={accessibleName} disabled={!!error} title={error} onClick={() => {
        if (!error && onCommand(cmd)) onFeedback(`${actor.name}が${from.name}から${to.name}へ銀貨${amount}枚を移しました。時計は進みません。`);
      }}>{label}</button>
      {error ? <small className="travel-reason">{error}</small>
        : <small className="coin-transfer-preview">実行後：{from.name} {preview.fromAfter}枚 · {to.name} {preview.toAfter}枚</small>}
    </div>;
  }
  return <section className="coin-transfer-controls" aria-label="銀貨の受渡し操作">
    <h4>銀貨</h4>
    <p className="coin-transfer-balances">{actor.name} {getWalletCoins(game, actor.id)}枚 · {peer.name} {getWalletCoins(game, peer.id)}枚</p>
    <label>銀貨の枚数<input type="number" min="1" step="1" inputMode="numeric" value={Number.isFinite(amount) ? amount : ""} onChange={event => {
      setAmount(event.target.value === "" ? NaN : Number(event.target.value));
      onFeedback("");
    }} /></label>
    <div className="travel-button-grid">
      {direction(actor, peer, "give")}
      {direction(peer, actor, "take")}
    </div>
    <p className="coin-transfer-note">同じ場所の二人の手元へ移します。時間は進みません。</p>
  </section>;
}

export function CarryLine({ game, resident }: { game: GameState; resident: Resident }) {
  const load = getCarryLoad(game, resident.id);
  return <span className={`carry-line ${load.ratio > 1 ? "carry-overloaded" : ""}`}>
    <Backpack size={12} aria-hidden="true" />
    {number(load.weight)} / {number(load.capacity)} kg · {load.label}
  </span>;
}

export function TravelPanel({ game, focusedId, selectedIds, onCommand }: {
  game: GameState; focusedId: string; selectedIds: string[]; onCommand: (cmd: Command) => boolean;
}) {
  const [resource, setResource] = useState<keyof Resources>("food");
  const [amount, setAmount] = useState(1);
  const [otherId, setOtherId] = useState("");
  const [feedback, setFeedback] = useState("");
  const actor = game.residents.find(p => p.id === (selectedIds.length === 1 ? selectedIds[0] : focusedId)) ?? game.residents[0];
  const canAct = selectedIds.length === 1 && selectedIds[0] === actor.id;
  useEffect(() => setFeedback(""), [actor.id, actor.location]);
  const pack = game.inventory?.packs[actor.id] ?? empty();
  const coins = getWalletCoins(game, actor.id);
  const free = ownFreeResources(game, actor.id);
  const baseFree = freeBaseResources(game);
  const atBase = isBaseLocation(actor.location);
  const atLodge = actor.location === "lodge";
  const sleep = inspectSleep(game, actor.id);
  const ground = game.inventory?.ground[actor.location] ?? empty();
  const peers = game.residents.filter(p => p.id !== actor.id && p.location === actor.location);
  const peer = peers.find(p => p.id === otherId) ?? peers[0];
  const label = RESOURCES.find(([id]) => id === resource)![1];
  const validAmount = Number.isSafeInteger(amount) && amount > 0;
  const labels: Record<string, string> = { base: "拠点倉庫", ground: atLodge ? "舟宿の物置" : "今いる場所の地面", ...Object.fromEntries(game.residents.map(p => [p.id, `${p.name}の荷物`])) };
  const cargoCommand: Command = {
    type: "assign", residentIds: selectedIds, kind: "move", target: "home",
    cargo: { resource, amount },
  };
  const cargoPreview = atBase ? undefined : command(game, cargoCommand);
  const cargoError = !canAct ? "運ぶ人を住民一覧で一人だけ選んでください。"
    : !validAmount ? "個数は1以上の整数で指定してください。"
    : cargoPreview?.error;
  const candidate = !cargoError
    ? cargoPreview?.state.residents.find(person => person.id === actor.id)?.action
    : undefined;
  const plannedCargo = candidate?.kind === "move" && candidate.target === "home"
    && candidate.cargo?.resource === resource && candidate.cargo.amount === amount
    ? candidate : undefined;
  const cargoReason = cargoError ?? (!plannedCargo ? "手持ちの物資と帰路を確認してください。" : undefined);
  const inputs = <div className="travel-inputs">
    <label>動かす物<select value={resource} onChange={e => { setResource(e.target.value as keyof Resources); setFeedback(""); }}>
      {RESOURCES.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
    </select></label>
    <label>個数<input type="number" min="1" step="1" value={Number.isFinite(amount) ? amount : ""} inputMode="numeric" onChange={e => { setAmount(e.target.value === "" ? NaN : Number(e.target.value)); setFeedback(""); }} /></label>
  </div>;
  const sharingNote = <p className="travel-note">食事と手当は本人の荷物を優先し、足りない分だけ同じ場所の仲間から融通します。離れた人の荷物は使えません。</p>;
  function button(from: string, to: string, text: string) {
    const cmd: Command = { type: "transfer", residentId: actor.id, from, to, resource, amount };
    const error = !canAct ? "受渡しをする人を住民一覧で一人だけ選んでください。"
      : !validAmount ? "個数は1以上の整数で指定してください。"
      : command(game, cmd).error;
    return <div className="travel-transfer" key={`${from}-${to}`}>
      <button type="button" disabled={!!error} title={error} onClick={() => {
        if (onCommand(cmd)) setFeedback(`${label}${amount}を${labels[from]}から${labels[to]}へ移しました。時計は進みません。`);
      }}>{text}</button>
      {error && <small className="travel-reason">{error}</small>}
    </div>;
  }
  const cargoControls = (
    <div className="travel-transfer cargo-return" aria-label="倉庫への片道運搬">
      {plannedCargo && <p className="cargo-return-preview">
        {actor.name} · 帰路 {Math.ceil(plannedCargo.duration)}分 · 確保する物：{label}{amount}
      </p>}
      <button type="button" data-cargo-return disabled={!!cargoReason} title={cargoReason} onClick={() => {
        if (onCommand(cargoCommand)) setFeedback(`${actor.name}の${label}${amount}を確保し、倉庫への運搬を予約しました。`);
      }}>
        {validAmount ? `手持ちの${label}${amount}を倉庫へ届ける` : "倉庫へ届ける"}
      </button>
      <p className="travel-note">時間を進めると帰着時に指定分を収納して終了します。採集は、別の指示で行います。</p>
      {plannedCargo && (resource === "food" || resource === "medicine") && <p className="travel-note">
        この確保分は、運搬中の食事や手当には使えません。
      </p>}
      {cargoReason && <small className="travel-reason">{cargoReason}</small>}
    </div>
  );
  return <details className="panel travel-panel" onToggle={() => setFeedback("")}>
    <summary><Backpack size={17} /><strong>荷物と旅支度</strong><span>{actor.name}</span><ChevronDown size={15} /></summary>
    <div className="travel-panel-body">
      <p className="travel-context">{actor.name} · {LOCATIONS[actor.location].name}</p>
      <CarryLine game={game} resident={actor} />
      <p className="travel-note">装備・携帯中の作品・予約中の物資{coins > 0 ? "・銀貨" : ""}も重さに含みます。救助中は相手とその荷物も加わり、重いほど移動に時間がかかります。</p>
      <div className="pack-resources" aria-label={`${actor.name}の所持品`}>
        {RESOURCES.map(([id, name, unit]) => <div key={id}><span>{name}</span><strong>{number(pack[id])}<small>{unit}</small></strong>
          {pack[id] - free[id] > 0 && <small>うち予約 {number(pack[id] - free[id])}</small>}
        </div>)}
      </div>
      {coins > 0 && <p className="pack-coins" aria-label={`${actor.name}の所持銀貨`}>
        <span>銀貨 <strong>{coins}枚</strong>（{Number((coins * COIN_WEIGHT).toFixed(2))}kg）</span>
        <small>本人が持ち歩くお金です。</small>
      </p>}
      {atBase && sharingNote}
      {!atBase && <>
        {inputs}
        {!atLodge && cargoControls}
      </>}
      {!atLodge && <div className="travel-stock-context"><Package size={14} /><span>{atBase
        ? `拠点倉庫の未予約分：${RESOURCES.map(([id, name]) => `${name}${number(baseFree[id])}`).join(" · ")}`
        : "倉庫との受渡しは拠点内で行います。ここから運んで届ける場合は、帰路の時間がかかります。"}</span></div>}
      <p className="travel-note">{atLodge ? "舟宿の物置" : "地面にある物"}：{RESOURCES.filter(([id]) => ground[id] > 0).map(([id, name]) => `${name}${number(ground[id])}`).join(" · ") || "なし"}</p>
      {!canAct && <p className="travel-selection-note">内容は{actor.name}の荷物です。荷物を動かす人は、住民一覧で一人だけ選んでください。</p>}
      {atBase && inputs}
      <div className="travel-button-grid">
        {!atLodge && button("base", actor.id, "倉庫から持ち出す")}
        {!atLodge && button(actor.id, "base", "倉庫へしまう")}
        {button(actor.id, "ground", atLodge ? "物置に預ける" : "地面に置く")}
        {button("ground", actor.id, atLodge ? "物置から取り出す" : "地面から拾う")}
      </div>
      {peer && <div className="travel-peer">
        <label>同じ場所の仲間<select value={peer.id} onChange={e => { setOtherId(e.target.value); setFeedback(""); }}>
          {peers.map(p => {
            const wallet = getWalletCoins(game, p.id);
            return <option value={p.id} key={p.id}>{p.name}{wallet > 0 ? `（銀貨${wallet}枚）` : ""}</option>;
          })}
        </select></label>
        <div className="travel-button-grid">
          {button(actor.id, peer.id, `${peer.name}へ渡す`)}
          {button(peer.id, actor.id, `${peer.name}から受け取る`)}
        </div>
        {(coins > 0 || getWalletCoins(game, peer.id) > 0) && <CoinTransferControls
          key={`${actor.id}:${peer.id}`} game={game} actor={actor} peer={peer} canAct={canAct}
          onCommand={onCommand} onFeedback={setFeedback}
        />}
      </div>}
      <CoinTransferHistory game={game} residentId={actor.id} />
      {feedback && <p className="travel-feedback" role="status">{feedback}</p>}
      {atLodge && <details className="lodge-return-options">
        <summary>丘の家の倉庫へ運ぶ</summary>
        {cargoControls}
      </details>}
      {!atBase && sharingNote}
      {!atBase && <div className="travel-sleep-site" aria-label={`${actor.name}の旅先の寝場所`}>
        <h4><Moon size={15} />{sleep.site?.name ?? "ここには寝場所がありません"}</h4>
        {sleep.site ? <p>{sleep.site.description}</p> : <p>旅先では、集落の休み所・木陰の雨よけ・舟宿の寝床で眠れます。</p>}
        <p>睡眠は最長8時間（朝8時を迎えればそこで終了）。{sleep.site?.healsWounds ? "" : "体力と元気は拠点よりゆっくり戻り、負傷は治りません。"}満腹度は戻りません。</p>
        <p>{actor.name}の携行・未予約：食事 {number(free.food)}食 · 手当用品 {number(free.medicine)}個。食事は寝る前に指示してください。</p>
        {sleep.error && <small>{sleep.error}</small>}
      </div>}
    </div>
  </details>;
}
