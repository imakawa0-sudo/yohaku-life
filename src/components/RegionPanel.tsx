import { useEffect, useState } from "react";
import { ChevronDown, Coins, MapPin, MessageCircle, Route } from "lucide-react";
import { command, getVillageCash, getVillageStock, getWalletCoins, LOCATIONS, getRouteWorkSummary, GUARD_AGREEMENT_RULE } from "../game/engine";
import { getEncounters } from "../game/encounters";
import { AGREEMENT_FOOD_TERMS_ID, hasReportedGuardAgreement, inspectRegionInteraction, LODGE_KEEPER, regionNPCsAt, type RegionChoice } from "../game/region";
import { getRecruitmentStatus } from "../game/recruitment";
import type { Command, GameState, LocationId, Resources } from "../game/types";
import { TradeHistory } from "./TradeHistory";
import { VillageArtPanel } from "./VillageArtPanel";
import { getTogetherTravelSelection } from "./together-travel";

const RESOURCE_NAMES: Record<keyof Resources, string> = { food: "食事", ingredients: "食材", medicine: "手当用品", scrap: "資材" };
const resourcesText = (value: Partial<Resources>) => Object.entries(value).filter(([, n]) => n && n > 0).map(([key, n]) => `${RESOURCE_NAMES[key as keyof Resources]}${n}`).join("・");
const COIN_CHOICES = ["sell-scrap", "buy-food", "buy-medicine"] as const;

export function RegionPanel({ game, focusedId, selectedIds, onCommand }: {
  game: GameState; focusedId: string; selectedIds: string[]; onCommand: (cmd: Command) => boolean;
}) {
  const selectedActor = selectedIds.length === 1 ? game.residents.find(p => p.id === selectedIds[0]) : undefined;
  const actor = selectedActor ?? game.residents.find(p => p.id === focusedId) ?? game.residents[0];
  const focused = game.residents.find(p => p.id === focusedId) ?? actor;
  const selectionError = selectedActor ? undefined : "行動する人を住民一覧で一人だけ選んでください。";
  const [feedback, setFeedback] = useState<{ npcId: string; text: string }>();
  useEffect(() => setFeedback(undefined), [actor.id, selectedActor?.id]);
  if (focused.location === LODGE_KEEPER.location) {
    if (game.residents.some(person => person.id === LODGE_KEEPER.id)) return null;
    const invitation = getRecruitmentStatus(game, selectedActor?.id ?? "", LODGE_KEEPER.id);
    const reason = selectionError ?? invitation.error;
    const progress = invitation.mealProgress!;
    return <section className="panel region-panel" aria-label="舟宿番との交流">
      <div className="section-header"><h3><MessageCircle size={17} /> {LODGE_KEEPER.name}</h3><span>08:00–18:00</span></div>
      <p className="travel-note">{regionNPCsAt(game, LODGE_KEEPER.location).length
        ? LODGE_KEEPER.description : "板間にナギの綯いかけの縄が置いてある。舟宿番は朝八時に戻る。"}</p>
      <div className="region-recruitment">
        <p>別々の二日、舟宿の工房で08:00以降、18:00になる前に食事を終えると、その住民からナギを誘えます。</p>
        {selectedActor && <p>{selectedActor.name}がここで昼間に食事をした日　<strong>{progress.days} / 2日</strong>
          {progress.ateToday ? "（今日の分を含む）" : ""}</p>}
        <button disabled={!!reason || !invitation.available} title={reason}
          onClick={() => { if (selectedActor) onCommand({ type: "recruit", residentId: selectedActor.id, npcId: LODGE_KEEPER.id }); }}>
          {invitation.title}
        </button>
        {reason && <small>{reason}</small>}
      </div>
    </section>;
  }
  if (actor.location !== "village" && focused.location !== "village") return null;
  const npcs = regionNPCsAt(game, "village");
  const canTellAgreement = selectedActor && game.guardAgreement?.actorId === selectedActor.id;
  const agreementReported = selectedActor && hasReportedGuardAgreement(game, selectedActor.id);
  return <section className="panel region-panel" aria-label="集落での交流と交換">
    <div className="section-header"><h3><MessageCircle size={17} /> 集落で過ごす</h3><span>08:00–18:00</span></div>
    <p className="travel-context">行動する人：{selectedActor ? `${selectedActor.name} · ${LOCATIONS[selectedActor.location].name}` : "住民一覧で一人だけ選択"}</p>
    <p className="travel-note">渡す物は本人の荷物から使います。話や交換の操作で時計は進みません。</p>
    {!npcs.length && <p className="travel-selection-note">店と道案内は、朝8時から夕方6時までです。</p>}
    {npcs.map(npc => {
      const recruitment = npc.id === "village-guide" ? getRecruitmentStatus(game, actor.id, npc.id) : undefined;
      const recruitmentError = !selectedActor
        ? "誘う人を住民一覧で一人だけ選んでください。" : recruitment?.error;
      const choices: RegionChoice[] = npc.id === "village-trader"
        ? ["talk", ...(canTellAgreement && !agreementReported ? ["report-agreement" as const] : []), "trade-food", "trade-medicine"]
        : ["talk", "deliver"];
      return <article className="region-person" key={npc.id}>
      <h4>{npc.name}</h4><span>{npc.role}</span><p>{npc.description}</p>
      {feedback?.npcId === npc.id && <p className="travel-feedback" role="status">{feedback.text}</p>}
      {npc.id === "village-trader" && agreementReported && <p className="region-agreement">
        商い手は{selectedActor.name}から、守り手が道を譲った話を聞いている。
        {selectedActor.name}への信用 {game.region?.trust["village-trader"][selectedActor.id]} · 一日一度、資材1個で食事3食。
      </p>}
      <div className="region-choices">{choices.map(choice => {
        const preview = inspectRegionInteraction(game, selectedActor?.id ?? "", npc.id, choice);
        const error = selectionError ?? preview.error;
        const talkTopic = npc.id === "village-guide" ? "尾根と川沿いの道の違い" : "交換できる品と店の在庫";
        const hint = choice === "talk" ? `${npc.name}に、${talkTopic}を尋ねます。`
          : choice === "report-agreement" ? "守り手に食事を渡し、置き場を通れるようになったことを商い手に伝えます。"
          : choice === "trade-food" && agreementReported
            ? preview.termsId === AGREEMENT_FOOD_TERMS_ID ? "道の知らせのお礼。今日の一度分を使います。" : "今日のお礼は受け取り済み。次は明日の開店からです。"
          : resourcesText(preview.received) ? `受取：${resourcesText(preview.received)}` : preview.text;
        const label = choice === "trade-food" || choice === "trade-medicine"
          ? `${resourcesText(preview.paid)}を${resourcesText(preview.received)}と交換`
          : choice === "deliver" ? "食事3を届ける（任意）" : preview.title;
        return <div className="region-choice" key={choice}>
          <button disabled={!!error} title={error} onClick={() => {
            if (selectedActor && onCommand({ type: "region", residentId: selectedActor.id, npcId: npc.id, choice })) setFeedback({ npcId: npc.id, text: preview.text });
          }}>{label}</button>
          <small>{error ?? hint}</small>
        </div>;
      })}</div>
      {npc.id === "village-trader" && <details className="region-currency" aria-label="銀貨での売買">
        <summary><Coins size={16} aria-hidden="true" /><strong>銀貨で売買する</strong><ChevronDown size={15} aria-hidden="true" /></summary>
        <div className="region-currency-body">
          <div className="region-currency-facts">
            <p className="region-wallet">{selectedActor
              ? <>{selectedActor.name}の所持銀貨 <strong>{getWalletCoins(game, selectedActor.id)}枚</strong></>
              : "所持銀貨は、売買する住民を一人選ぶと表示します。"}</p>
            <p className="region-shop-cash">店の買取資金 <strong>{getVillageCash(game)}枚</strong></p>
            <p className="region-shop-stock">店の在庫：食事{getVillageStock(game).food}食 · 手当用品{getVillageStock(game).medicine}個</p>
          </div>
          <p className="region-currency-note">銀貨は本人が持ち歩きます。資材を売って受け取り、食事や手当用品を買えます。売買では時間は進みません。</p>
          <div className="region-coin-choices">
            {COIN_CHOICES.map(choice => {
              const preview = inspectRegionInteraction(game, selectedActor?.id ?? "", npc.id, choice);
              const error = selectionError ?? preview.error;
              return <div className="region-choice region-coin-choice" data-coin-choice={choice} key={choice}>
                <button disabled={!!error} title={error} onClick={() => {
                  if (selectedActor && onCommand({ type: "region", residentId: selectedActor.id, npcId: npc.id, choice })) setFeedback({ npcId: npc.id, text: preview.text });
                }}>{preview.title}</button>
                <small>{error ?? (preview.walletAfter !== undefined ? `売買後の所持銀貨：${preview.walletAfter}枚` : "")}</small>
              </div>;
            })}
          </div>
        </div>
      </details>}
      {npc.id === "village-trader" && <VillageArtPanel key={selectedActor?.id ?? ""} game={game} actor={selectedActor} onCommand={onCommand} />}
      {recruitment && <div className="region-recruitment">
        <p>{selectedActor ? `${selectedActor.name}への信用 ${recruitment.trust} / ${recruitment.requiredTrust}` : "信用は、選んだ本人の交流で育ちます。"}</p>
        <p>{recruitment.text}</p>
        <button disabled={!!recruitmentError || !recruitment.available} title={recruitmentError} onClick={() => {
          if (selectedActor && onCommand({ type: "recruit", residentId: selectedActor.id, npcId: npc.id }))
            setFeedback({ npcId: npc.id, text: "新しい仲間が住民一覧に加わりました。操作したい時は、住民一覧で選んでください。時間は進んでいません。" });
        }}>{recruitment.title}（任意）</button>
        {recruitmentError && <small>{recruitmentError}</small>}
      </div>}
    </article>;})}
    {feedback && !npcs.some(npc => npc.id === feedback.npcId) && <p className="travel-feedback" role="status">{feedback.text}</p>}
    <TradeHistory game={game} scope="village" />
    <p className="travel-note">頼みごとは一度だけ。引き受けずに、調達や景色を楽しんで帰ることもできます。</p>
  </section>;
}

export function DayTripRoutes({ game, selectedIds, onCommand, onTogetherRoute }: {
  game: GameState; selectedIds: string[]; onCommand: (cmd: Command) => boolean;
  onTogetherRoute?: (target: LocationId, via: LocationId[]) => void;
}) {
  const selected = game.residents.filter(p => selectedIds.includes(p.id));
  const togetherPair = getTogetherTravelSelection(game, selectedIds);
  const routeWork = getRouteWorkSummary(game);
  const anchor = selected.length && selected.every(p => LOCATIONS[p.location].kind === "base") ? "home"
    : selected.length && selected.every(p => p.location === selected[0].location) ? selected[0].location : undefined;
  const upstream = anchor === "reedbank" || anchor === "lodge";
  const targets: ("village" | "home")[] = selected.length && selected.every(p => p.location === "village") ? ["home"]
    : selected.length && selected.every(p => LOCATIONS[p.location].kind === "base") ? ["village"] : ["village", "home"];
  return <section id="daytrip-routes" className="panel daytrip-routes" aria-label="日帰りの道順を選ぶ">
    <div className="section-header"><h3><Route size={17} /> 日帰りの道順</h3></div>
    <p className="travel-context">{selected.map(p => p.name).join("・") || "住民一覧で行動する人を選んでください。"}</p>
    <div className="route-choice-grid">{targets.flatMap(target => {
      const kinds = target === "village" && upstream ? ["upstream"]
        : target === "village" && anchor === "ridge" ? ["short"]
        : target === "village" && anchor === "meadow" ? ["safe"]
        : target === "home" && ["home", "road", "shelter"].includes(anchor ?? "") ? ["safe"] : ["safe", "short"];
      return kinds.map(kind => {
      const via: LocationId[] = kind === "upstream" ? [] : target === "village"
        ? kind === "safe" ? ["road", "meadow"] : anchor === "shelter" ? ["ruins", "ridge"] : ["road", "ruins", "ridge"]
        : kind === "safe"
          ? anchor === "ridge" ? ["village", "meadow", "road"] : anchor === "ruins" ? ["shelter", "road"] : ["home", "road", "shelter"].includes(anchor ?? "") ? [] : ["meadow", "road"]
          : anchor === "meadow" ? ["village", "ridge", "ruins", "road"] : ["ridge", "ruins", "road"];
      const ids = selected.filter(p => p.location !== target).map(p => p.id);
      const cmd: Command = { type: "assign", residentIds: ids, kind: "move", target, via };
      const preview = ids.length ? command(game, cmd) : undefined;
      const error = !selected.length ? "行動する人を選んでください。" : !anchor ? "道順を選ぶ人は、同じ場所（または拠点内）に集まってから選択してください。" : !ids.length ? "全員が到着しています。" : preview?.error;
      const route = kind === "upstream" ? "上流の道" : target === "home" && ["home", "road", "shelter"].includes(anchor ?? "") ? "帰り道"
        : target === "home" && anchor === "ruins" && kind === "safe" ? "木陰の道"
        : target === "home" && anchor === "meadow" && kind === "short" ? "資材置き場を通る道"
        : target === "village" && anchor === "ridge" ? "尾根の道" : kind === "safe" ? "川沿いの道" : "資材置き場を通る近道";
      const destination = target === "village" ? "集落へ" : "拠点へ帰る";
      const duration = !error && preview ? preview.state.residents.filter(p => ids.includes(p.id)).map(p => `${p.name} ${Math.ceil(p.action?.duration ?? 0)}分`).join("・") : "";
      const paths = !error && preview ? preview.state.residents.filter(p => ids.includes(p.id)).map(p => p.action?.path ?? []) : [];
      const routeTouches = (location: LocationId) => !error && preview && preview.state.residents
        .filter(person => ids.includes(person.id))
        .some(person => person.action?.kind === "move" && person.action.origin
          && [person.action.origin, ...(person.action.path ?? [])].includes(location));
      const encountersOnRoute = getEncounters(game).filter(encounter => encounter.present && routeTouches(encounter.location));
      const guardOnRoute = encountersOnRoute.some(encounter => encounter.id === GUARD_AGREEMENT_RULE.counterpartId);
      const agreementOnRoute = !!game.guardAgreement && routeTouches(GUARD_AGREEMENT_RULE.location);
      const routeWarnings = [
        agreementOnRoute ? "守り手は食事を受け取り立ち去っています。" : guardOnRoute ? "守り手のいる場所を通ります。遭遇に注意。" : "",
        ...encountersOnRoute.filter(encounter => encounter.id !== GUARD_AGREEMENT_RULE.counterpartId)
          .map(encounter => `${encounter.name}のいる場所を通ります。遭遇に注意。`),
      ].join("");
      // Action.path omits its starting point. Keep it when checking the first
      // edge, in particular for a return trip starting in the village.
      const routeUsesRiverPath = !error && preview && preview.state.residents
        .filter(person => ids.includes(person.id))
        .some(person => {
          const job = person.action;
          if (job?.kind !== "move" || !job.origin || !job.path) return false;
          const points = [job.origin, ...job.path];
          return points.some((from, index) => {
            const to = points[index + 1];
            const [a, b] = routeWork.rule.edge;
            return (from === a && to === b) || (from === b && to === a);
          });
        });
      const roadWorker = routeWork.working
        ? game.residents.find(person => person.id === routeWork.working!.residentId) : undefined;
      const riverPathStatus = routeWork.completed
        ? `川辺–集落：整備済み（区間の基準${routeWork.rule.afterMinutes}分）`
        : roadWorker
          ? routeWork.working!.blockedReason
            ? `川辺–集落：整備は待機中。${routeWork.working!.blockedReason}（基準${routeWork.rule.beforeMinutes}分のまま）`
            : `川辺–集落：${roadWorker.name}が${routeWork.working!.paused ? "整備を中断中" : "整備中"}（基準${routeWork.rule.beforeMinutes}分のまま）`
          : `川辺–集落：いつもの道（区間の基準${routeWork.rule.beforeMinutes}分）`;
      const pathText = paths.length ? paths[0].map(id => LOCATIONS[id].name).join(" · ") : "";
      return <div className="route-choice" key={`${target}-${kind}`}>
        <button disabled={!!error} title={error} onClick={() => onCommand(cmd)}><MapPin size={15} /><strong>{route}で{destination}</strong></button>
        <small>{error ?? duration}</small>
        <p data-guard-agreement-route-status={agreementOnRoute ? "completed" : undefined}>
          {routeWarnings}{pathText || (kind === "safe" ? "川辺を通る道順。" : "置き場と尾根を通る道順。")}
        </p>
        {routeUsesRiverPath && <small className="route-work-route-status" data-route-work-status>{riverPathStatus}</small>}
        {togetherPair && onTogetherRoute && <button type="button" className="together-route-link" data-together-route={`${target}-${kind}`}
          onClick={() => onTogetherRoute(target, [...via])}>2人の道順に選ぶ</button>}
      </div>;
    });})}</div>
    <p className="travel-note">予約では時計は進みません。荷物と負傷で所要時間が変わり、同時に出ても到着は別々になります。</p>
  </section>;
}
