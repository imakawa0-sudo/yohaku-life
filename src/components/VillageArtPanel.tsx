import { useState } from "react";
import { ChevronDown, Feather } from "lucide-react";
import { getCraftDisplayTitle } from "../game/art-subject";
import { formatTime } from "../game/engine";
import { getVillageArt } from "../game/village-art";
import type { Command, GameState, Resident } from "../game/types";

export function VillageArtPanel({ game, actor, onCommand }: {
  game: GameState;
  actor?: Resident;
  onCommand: (cmd: Command) => boolean;
}) {
  const [chosenId, setChosenId] = useState<number>();
  const art = getVillageArt(game, actor?.id ?? "");
  const selected = art.choices.find(choice => choice.craftId === chosenId)
    ?? (art.choices.length === 1 ? art.choices[0] : undefined);
  const otherWorks = (game.life?.crafts ?? []).filter(piece => piece.displayLocation === "village" && piece.authorId !== actor?.id);
  const names = new Map(game.residents.map(person => [person.id, person.name]));
  const titleCounts = new Map<string, number>();
  for (const choice of art.choices) titleCounts.set(choice.title, (titleCounts.get(choice.title) ?? 0) + 1);
  function choiceLabel(choice: (typeof art.choices)[number]) {
    return (titleCounts.get(choice.title) ?? 0) > 1
      ? `${choice.title}（第${Math.floor(choice.createdAt / 1440) + 1}日 ${formatTime(choice.createdAt)}制作）` : choice.title;
  }
  const chooseWork = !art.first || (art.heardAt !== undefined && !art.companion);
  const reason = actor ? art.offerError : "住民一覧で作者を一人選んでください。";

  const otherWorkList = <ul className="village-art-others" aria-label="店先に飾られた作品">
    {otherWorks.map(piece => <li key={piece.id}>{names.get(piece.authorId)}の「{getCraftDisplayTitle(game, piece)}」</li>)}
  </ul>;
  return <details className="village-art" open={!!art.first || art.choices.length > 0 || otherWorks.length > 0}>
    <summary><Feather size={16} aria-hidden="true" /><strong>店先の飾り棚</strong><ChevronDown size={15} aria-hidden="true" /></summary>
    <div className="village-art-body">
      {otherWorks.length > 2 ? <details>
        <summary>店先に飾られたほかの作品（{otherWorks.length}点）</summary>
        {otherWorkList}
      </details> : otherWorks.length > 0 && otherWorkList}
      <div aria-live="polite">
        {art.first ? <>
          <p>{actor?.name}の「{getCraftDisplayTitle(game, art.first)}」
            {art.companion ? <>と「{getCraftDisplayTitle(game, art.companion)}」が店先に並んでいる。</> : "が店先に飾られている。"}</p>
          {art.feedback && !art.companion && <p className="village-art-reply">{art.feedback}</p>}
        </> : <p>商い手「自分で彫ったものがあれば、ここに一つ飾っていかないかい」</p>}
      </div>
      {chooseWork ? <>
        {art.choices.length > 0 && <label>預ける作品
          <select value={selected?.craftId ?? ""} onChange={event => setChosenId(Number(event.target.value))}>
            <option value="">作品を選ぶ</option>
            {art.choices.map(choice => <option key={choice.craftId} value={choice.craftId}>{choiceLabel(choice)}</option>)}
          </select>
        </label>}
        {art.choices.length > 0 && <p className="region-currency-note">
          {selected ? `「${choiceLabel(selected)}」は、預けると集落に残ります。` : "預けた作品は集落に残ります。"}
        </p>}
        <div className="region-choice">
          <button type="button" disabled={!!reason || !selected} title={reason} onClick={() => {
            if (actor && selected) onCommand({ type: "exhibit-village-art", residentId: actor.id, craftId: selected.craftId });
          }}>{art.first ? "二つの景色を並べる" : "店先に作品を預ける"}</button>
          {reason && <small>{reason}</small>}
        </div>
      </> : art.heardAt === undefined && <div className="region-choice">
        <button type="button" disabled={!actor || !!art.listenError} title={art.listenError} onClick={() => {
          if (actor) onCommand({ type: "hear-village-art", residentId: actor.id });
        }}>作品の感想を聞く</button>
        {art.listenError && <small>{art.listenError}</small>}
      </div>}
    </div>
  </details>;
}
