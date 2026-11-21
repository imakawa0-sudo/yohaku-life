import { ArrowRight, Flag, Footprints, House, Leaf, Shield, Sprout } from "lucide-react";
import { LOCATIONS, getEncounters, inspectTravelRoute } from "../game/engine";
import { getLocationSummary } from "../game/content";
import type { Command, GameState, LocationId } from "../game/types";

const areas: { name: string; places: LocationId[] }[] = [
  { name: "丘のふもとと集落", places: ["home", "garden", "road", "shelter", "ruins", "meadow", "ridge", "village"] },
  { name: "上流の水郷", places: ["reedbank", "lodge"] },
];
export function Destinations({ game, selectedIds, onMove, onCommand }: {
  game: GameState; selectedIds: string[]; onMove: (place: LocationId) => void; onCommand: (cmd: Command) => boolean;
}) {
  const selected = game.residents.filter(person => selectedIds.includes(person.id));
  const encounters = getEncounters(game).filter(e => e.present);
  return <div className="destinations">{areas.map(area => <section key={area.name} aria-label={area.name} className="destination-area">
    <h4>{area.name}</h4>
    {area.places.map(id => {
      const travelers = selected.filter(person => person.location !== id);
      const routes = travelers.flatMap(person => {
        const route = inspectTravelRoute(game, person.id, id);
        return route ? [{ person, ...route }] : [];
      });
      const dangers = encounters.filter(e => routes.some(route => route.path.includes(e.location)));
      const leaving = encounters.filter(e => travelers.some(person => person.location === e.location));
      const underway = dangers.filter(e => e.location !== id);
      const warnings = [
        ...(leaving.length ? [`交戦地から出発 · ${leaving.map(e => LOCATIONS[e.location].name).join("・")}`] : []),
        ...(underway.length ? [`途中で遭遇 · ${underway.map(e => LOCATIONS[e.location].name).join("・")}`] : []),
        ...(dangers.some(e => e.location === id) ? ["到着先に相手がいます"] : []),
      ];
      const canDetour = !leaving.length && dangers.length > 0 && travelers.every(person => person.location === travelers[0].location);
      const detours = canDetour ? travelers.map(person => inspectTravelRoute(game, person.id, id, true)) : [];
      const detour = detours[0];
      const times = routes.map(r => (routes.length > 1 ? r.person.name + " " : "") + r.minutes + "分").join("・");
      const DestinationIcon = id === "home" || id === "lodge" ? House : id === "garden" ? Sprout : id === "road" ? Footprints : id === "shelter" ? Shield : id === "reedbank" ? Leaf : Flag;
      return <div key={id} className="destination-choice" id={`destination-${id}`}>
        <button type="button" className="destination-direct" aria-label={`${LOCATIONS[id].name}へ移動`}
          aria-describedby={`journey-${id}`} disabled={!travelers.length} onClick={() => onMove(id)}>
          <span className={`destination-icon ${warnings.length ? "danger" : ""}`}><DestinationIcon size={20} /></span>
          <span className="destination-main"><strong>{LOCATIONS[id].name}</strong>
            <small>{getLocationSummary(game, id)}</small>
            <small id={`journey-${id}`}>{times || (selected.length ? "現在地" : "住民を選んでください")}
              {warnings.map(text => <b className="journey-warning" key={text}>{text}</b>)}
            </small>
          </span>
          <ArrowRight size={15} aria-hidden="true" />
        </button>
        {detour && <button className="destination-detour" type="button" onClick={() => onCommand({
          type: "assign", residentIds: travelers.map(person => person.id), kind: "move", target: id, via: detour.path.slice(0,-1),
        })}>遭遇を避ける道で出発 · {detours.map((r,i) => (detours.length > 1 ? travelers[i].name + " " : "") + r!.minutes + "分").join("・")}</button>}
      </div>;
    })}
  </section>)}</div>;
}
