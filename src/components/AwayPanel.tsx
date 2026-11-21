import { ChevronDown, MapPin, Users } from "lucide-react";
import { LOCATIONS } from "../game/engine";
import { freeBaseResources, isBaseLocation, ownFreeResources } from "../game/inventory";
import type { GameState, LocationId, Resident } from "../game/types";
import { getTogetherMoveInfo } from "./together-travel";

const quantity = (value: number) => Number(value.toFixed(1)).toString();
const activity = (game: GameState, person: Resident) => {
  if (person.hp <= 0) return `意識なし · ${isBaseLocation(person.location) ? "手当" : "救助"}が必要`;
  const together = getTogetherMoveInfo(game, person.id);
  return together ? `${together.peerName}と同行中 · 残り${together.remaining}分`
    : person.action?.label ?? (person.suspended ? `${person.suspended.label}（中断中）` : "手が空いている");
};

/** One pack per resident and one shared warehouse; viewing never issues a command. */
export function AwayPanel({ game, onFocus }: {
  game: GameState;
  onFocus: (residentId: string) => void;
}) {
  const locations = [...new Set(game.residents.map(person => person.location))];
  const warehouse = freeBaseResources(game);
  const groups = locations.map((location: LocationId) => {
    const people = game.residents.filter(person => person.location === location);
    const stock = people.reduce((sum, person) => {
      const own = ownFreeResources(game, person.id);
      return { food: sum.food + own.food, medicine: sum.medicine + own.medicine };
    }, { food: 0, medicine: 0 });
    return { location, people, stock };
  });
  return <details className="panel away-panel">
    <summary><Users size={17} /><strong>拠点と旅先</strong><span>{locations.length}か所 · {game.residents.length}人</span><ChevronDown size={15} /></summary>
    <div className="away-panel-body">
      <p className="away-warehouse">拠点の共用倉庫：食事 {quantity(warehouse.food)}食 · 手当用品 {quantity(warehouse.medicine)}個<small>未予約分 · 拠点内でのみ利用可。離れた場所からは使えません。</small></p>
      <div className="away-groups">
        {groups.map(({ location, people, stock }) => <section className="away-location" key={location} aria-label={`${LOCATIONS[location].name}にいる住民`}>
          <h4><MapPin size={14} />{LOCATIONS[location].name}<span>{people.length}人</span></h4>
          <p className="away-supplies">携行・未予約：食事 {quantity(stock.food)}食 · 手当用品 {quantity(stock.medicine)}個</p>
          <ul>{people.map(person => <li key={person.id}>
            <div><strong>{person.name}</strong><span>{activity(game, person)}</span></div>
            <button aria-label={`${person.name}の場面を見る`} onClick={() => onFocus(person.id)}>場面を見る</button>
          </li>)}</ul>
        </section>)}
      </div>
      <p className="travel-note">離れた人や移動中の仲間の荷物は使えません。「場面を見る」では指示対象の選択と時計は変わりません。</p>
    </div>
  </details>;
}
