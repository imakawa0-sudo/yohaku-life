import { BookOpen, ChevronDown } from "lucide-react";
import { LOCATIONS, formatTime } from "../game/engine";
import type { GameState } from "../game/types";

export function CoinTransferHistory({ game, residentId }: { game: GameState; residentId: string }) {
  const transfers = (game.currency?.transfers ?? [])
    .filter(entry => entry.from === residentId || entry.to === residentId)
    .sort((a, b) => b.time - a.time || b.logId - a.logId);
  if (!transfers.length) return null;
  const name = (id: string) => game.residents.find(person => person.id === id)?.name ?? "住民";
  return <details className="coin-transfer-history" aria-label={`${name(residentId)}の銀貨の受渡し履歴`}>
    <summary>
      <BookOpen size={16} aria-hidden="true" />
      <strong>銀貨の受渡し（{transfers.length}件）</strong>
      <ChevronDown size={15} aria-hidden="true" />
    </summary>
    {transfers.length > 10 && <p className="coin-transfer-history-note">新しい日時の10件を表示しています。</p>}
    <ul>
      {transfers.slice(0, 10).map(entry => <li key={entry.logId}>
        <div className="coin-transfer-history-meta">
          <time>第{Math.floor(entry.time / 1440) + 1}日 {formatTime(entry.time)}</time>
          <span>{LOCATIONS[entry.location].name}</span>
        </div>
        <p>{name(entry.from)} → {name(entry.to)} · 銀貨{entry.amount}枚</p>
        <small>操作：{name(entry.actorId)}</small>
      </li>)}
    </ul>
  </details>;
}
