import { useState } from "react";
import {
  Armchair,
  Bath,
  BedDouble,
  BookOpen,
  DoorOpen,
  Footprints,
  Grid2X2,
  House as HouseIcon,
  Plus,
  TreePine,
  Users,
  Utensils,
} from "lucide-react";
import {
  cellName,
  editHouse,
  fixtureKinds,
  furnishings,
  needLabels,
  needs,
  service,
  type FixtureKind,
  type House,
  type Need,
} from "./house";
import "./house.css";

const icons = {
  energy: BedDouble,
  bladder: DoorOpen,
  hygiene: Bath,
  hunger: Utensils,
  social: Users,
  fun: BookOpen,
};
const roomIcon = (id: string) =>
  id === "yard" ? TreePine : id === "bedroom" ? BedDouble : HouseIcon;
type TileTool = "floor" | "wall" | "door" | "furniture" | "move";

export function HouseEditor({
  house,
  onChange,
  waterMinutes = 0,
}: {
  house: House;
  onChange: (h: House) => void;
  waterMinutes?: number;
}) {
  const [selectedRoom, setRoom] = useState("living");
  const [nextRoom, setNextRoom] = useState("bedroom");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FixtureKind>("bath");
  const [moveTo, setMoveTo] = useState("living");
  const [fixtureId, setFixture] = useState("");
  const [tool, setTool] = useState<TileTool>("wall");
  const [square, setSquare] = useState(1);
  const [error, setError] = useState("");
  const room = house.rooms.find((r) => r.id === selectedRoom) ?? house.rooms[0];
  const otherRooms = house.rooms.filter((r) => r.id !== room.id);
  const neighbor = otherRooms.find((r) => r.id === nextRoom) ?? otherRooms[0];
  const connected = house.links.some(
    (pair) => pair.includes(room.id) && neighbor && pair.includes(neighbor.id),
  );
  const fixture =
    room.fixtures.find((f) => f.id === fixtureId) ?? room.fixtures[0];
  const moveRoom =
    house.rooms.find((r) => r.id === moveTo && r.id !== room.id) ??
    otherRooms[0];
  const cells = Array.from({ length: room.width * room.height }, (_, i) => i);
  const activeSquare = square < cells.length ? square : 1;
  const build = (edit: Parameters<typeof editHouse>[1]) => {
    try {
      const next = editHouse(house, edit);
      setError("");
      onChange(next);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "間取りを変更できませんでした。",
      );
    }
  };
  function chooseRoom(id: string) {
    setRoom(id);
    setSquare(1);
    setFixture("");
    setError("");
  }
  function useTile() {
    if (tool === "furniture")
      build({ type: "build", room: room.id, kind, cell: activeSquare });
    else if (tool === "move") {
      if (fixture)
        build({
          type: "move",
          room: room.id,
          id: fixture.id,
          cell: activeSquare,
        });
      else setError("移す家具を選んでください。");
    } else
      build({ type: "tile", room: room.id, cell: activeSquare, tile: tool });
  }
  const kindOptions = fixtureKinds.map((key) => (
    <option key={key} value={key}>
      {furnishings[key].name}（木材{furnishings[key].cost}）
    </option>
  ));
  const CurrentRoomIcon = roomIcon(room.id);
  return (
    <section className="yh-house" aria-label="住まいの間取り">
      <header className="yh-house-head">
        <HouseIcon size={22} />
        <h2>住まいの間取り</h2>
      </header>
      <div className="yh-house-rooms" aria-label="編集する部屋">
        {house.rooms.map((r) => {
          const Icon = roomIcon(r.id);
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={r.id === room.id}
              onClick={() => chooseRoom(r.id)}
            >
              <Icon size={16} />
              {r.name}
            </button>
          );
        })}
      </div>
      <div className="yh-house-floor">
        <div className="yh-house-floorhead">
          <h3>
            <CurrentRoomIcon size={18} />
            {room.name}
          </h3>
          <span>
            {room.width} × {room.height} マス
          </span>
        </div>
        <div className="yh-house-links">
          <DoorOpen size={15} />
          <span>
            隣の部屋　
            {house.links
              .filter((p) => p.includes(room.id))
              .map(
                (p) =>
                  house.rooms.find(
                    (r) => r.id === p.find((id) => id !== room.id),
                  )?.name,
              )
              .join("・") || "なし"}
          </span>
        </div>
        <div className="yh-house-furniture">
          {room.fixtures.map((f) => {
            const def = furnishings[f.kind],
              Icon = icons[def.need];
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={fixture?.id === f.id}
                onClick={() => setFixture(f.id)}
              >
                <Icon size={15} />
                {def.name}
              </button>
            );
          })}
          {!room.fixtures.length && <span>まだ家具がありません</span>}
        </div>
      </div>
      <div className="yh-house-metrics">
        <h4>
          <Footprints size={15} />
          {room.name}からの所要時間
        </h4>
        <dl>
          {needs.map((need: Need) => {
            const use = service(house, need, room.id, [], waterMinutes);
            return (
              <div key={need}>
                <dt>{needLabels[need]}</dt>
                <dd>{use ? use.minutes + "分" : "設備なし"}</dd>
              </div>
            );
          })}
        </dl>
      </div>
      {error && (
        <p role="alert" className="yh-house-error">
          {error}
        </p>
      )}
      <details className="yh-house-edit" open>
        <summary>
          <Armchair size={16} />
          家具を置く
        </summary>
        <div className="yh-house-controls">
          <label>
            新しく置く設備
            <select
              aria-label="新しく置く設備"
              value={kind}
              onChange={(e) => setKind(e.target.value as FixtureKind)}
            >
              {kindOptions}
            </select>
          </label>
          <button
            type="button"
            onClick={() => build({ type: "build", room: room.id, kind })}
          >
            <Plus size={15} />
            この部屋に置く
          </button>
        </div>
        {fixture && (
          <div className="yh-house-controls">
            <label>
              {furnishings[fixture.kind].name}を移す
              <select
                aria-label="移設先の部屋"
                value={moveRoom?.id ?? ""}
                onChange={(e) => setMoveTo(e.target.value)}
              >
                {otherRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!moveRoom}
              onClick={() =>
                moveRoom &&
                build({ type: "move", id: fixture.id, room: moveRoom.id })
              }
            >
              この部屋へ移す
            </button>
          </div>
        )}
      </details>
      <details className="yh-house-edit">
        <summary>
          <DoorOpen size={16} />
          部屋をつなぐ・増やす
        </summary>
        <div className="yh-house-controls">
          <label>
            {room.name}からの通路
            <select
              aria-label="通路の接続先"
              value={neighbor?.id ?? ""}
              onChange={(e) => setNextRoom(e.target.value)}
            >
              {otherRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!neighbor}
            onClick={() =>
              neighbor && build({ type: "link", a: room.id, b: neighbor.id })
            }
          >
            {connected ? "通路を閉じる" : "通路を開く（木材2）"}
          </button>
        </div>
        <div className="yh-house-controls">
          <label>
            {room.name}の隣に増築
            <input
              aria-label="新しい部屋の名前"
              value={name}
              maxLength={24}
              placeholder="例　浴室"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => build({ type: "room", name, neighbor: room.id })}
          >
            部屋を増やす（木材6）
          </button>
        </div>
      </details>
      <details className="yh-house-edit">
        <summary>
          <Grid2X2 size={16} />
          室内のマスを編集
        </summary>
        <div
          className="yh-house-blueprint"
          style={{
            gridTemplateColumns: `repeat(${room.width}, minmax(0, 1fr))`,
          }}
        >
          {cells.map((i) => {
            const f = room.fixtures.find((v) => v.cell === i);
            const tile = f
              ? "fixture"
              : i === 0
                ? "entry"
                : room.walls.includes(i)
                  ? "wall"
                  : room.doors.includes(i)
                    ? "door"
                    : "floor";
            const title = f
              ? furnishings[f.kind].name
              : {
                  entry: "入口",
                  wall: "壁",
                  door: "扉",
                  floor: "床",
                  fixture: "家具",
                }[tile];
            const Icon = f
              ? icons[furnishings[f.kind].need]
              : tile === "entry" || tile === "door"
                ? DoorOpen
                : null;
            return (
              <button
                key={i}
                type="button"
                aria-label={`${cellName(room, i)}　${title}`}
                aria-pressed={activeSquare === i}
                className={`yh-cell-${tile}`}
                onClick={() => {
                  setSquare(i);
                  if (f) setFixture(f.id);
                }}
              >
                {Icon ? <Icon size={16} /> : null}
                <span>{title}</span>
              </button>
            );
          })}
        </div>
        <div className="yh-house-controls">
          <label>
            {cellName(room, activeSquare)}の編集
            <select
              value={tool}
              onChange={(e) => setTool(e.target.value as TileTool)}
            >
              <option value="wall">壁にする（木材1）</option>
              <option value="door">扉にする（木材2）</option>
              <option value="floor">床に戻す</option>
              <option value="furniture">{furnishings[kind].name}を置く</option>
              {fixture && (
                <option value="move">
                  {furnishings[fixture.kind].name}を移す
                </option>
              )}
            </select>
          </label>
          <button type="button" onClick={useTile}>
            選んだマスに適用
          </button>
        </div>
        <div className="yh-house-minor">
          <button
            type="button"
            disabled={room.height >= 7}
            onClick={() => build({ type: "expand", room: room.id })}
          >
            一列広げる（木材{room.width}）
          </button>
          {fixture && (
            <button
              type="button"
              onClick={() => build({ type: "remove", id: fixture.id })}
            >
              {furnishings[fixture.kind].name}を取り外す
            </button>
          )}
        </div>
      </details>
    </section>
  );
}
