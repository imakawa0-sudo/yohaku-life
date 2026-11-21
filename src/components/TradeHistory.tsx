import { BookOpen, ChevronDown } from "lucide-react";
import type { GameState, Resources } from "../game/types";

type TradeHistoryScope = "all" | "merchant" | "village";
const SCOPE_NAMES: Record<TradeHistoryScope, string> = {
  all: "行商と集落の交換の記録",
  merchant: "行商の交換の記録",
  village: "集落の交換の記録",
};
const RESOURCE_NAMES: Record<keyof Resources, string> = {
  food: "食事", ingredients: "食材", medicine: "手当用品", scrap: "資材",
};
function resourcesText(resources: Partial<Resources>, coins = 0): string {
  const quantities = (Object.keys(RESOURCE_NAMES) as (keyof Resources)[])
    .filter(key => (resources[key] ?? 0) > 0)
    .map(key => `${RESOURCE_NAMES[key]}${resources[key]}`);
  if (coins > 0) quantities.push(`銀貨${coins}枚`);
  return quantities.join("・");
}
function dateText(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `第${Math.floor(minutes / 1440) + 1}日 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Historical amounts come from receipts, independently of today's exchange offers. */
export function TradeHistory({ game, scope = "all" }: {
  game: GameState;
  scope?: TradeHistoryScope;
}) {
  const entries = [
    ...(scope === "village" ? [] : (game.trade?.receipts ?? []).map(receipt => ({
      key: `merchant-${receipt.id}`, venue: "行商", actorId: receipt.actorId,
      time: receipt.time, paid: receipt.paid, received: receipt.received,
      coinsPaid: 0, coinsReceived: 0,
    }))),
    ...(scope === "merchant" ? [] : (game.region?.receipts ?? [])
      .map((receipt, index) => ({ receipt, index }))
      .filter(({ receipt }) => ["trade-food", "trade-medicine", "sell-scrap", "buy-food", "buy-medicine"].includes(receipt.choice))
      .map(({ receipt, index }) => ({
        key: `village-${index}`, venue: "集落", actorId: receipt.actorId,
        time: receipt.time, paid: receipt.paid, received: receipt.received,
        coinsPaid: receipt.coinsPaid ?? 0, coinsReceived: receipt.coinsReceived ?? 0,
      }))),
  ].sort((a, b) => b.time - a.time);
  return <details className="trade-history" data-trade-history={scope} aria-label={SCOPE_NAMES[scope]}>
    <summary>
      <BookOpen size={16} aria-hidden="true" />
      <strong>交換の記録（{entries.length}件）</strong>
      <ChevronDown size={15} aria-hidden="true" />
    </summary>
    <div className="trade-history-content">
      {!entries.length ? <p className="trade-history-note">交換の記録はまだありません。</p> : <>
        {entries.length > 10 && <p className="trade-history-note">新しい日時の10件を表示しています。</p>}
        <ul aria-label={`${SCOPE_NAMES[scope]}の一覧`}>
          {entries.slice(0, 10).map(entry => <li key={entry.key}>
            <div className="trade-history-meta">
              <time>{dateText(entry.time)}</time>
              <span>{game.residents.find(person => person.id === entry.actorId)?.name ?? "住民"} · {entry.venue}</span>
            </div>
            <p className="trade-history-exchange">
              <span>支払：{resourcesText(entry.paid, entry.coinsPaid)}</span>
              <span aria-hidden="true">→</span>
              <span>受取：{resourcesText(entry.received, entry.coinsReceived)}</span>
            </p>
          </li>)}
        </ul>
      </>}
    </div>
  </details>;
}
