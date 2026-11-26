import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Armchair,
  BookOpen,
  BookMarked,
  Download,
  Flag,
  GitBranch,
  Home,
  Leaf,
  MapPinned,
  Notebook,
  Plus,
  Sprout,
  Upload,
} from "lucide-react";
import { Life } from "./Life";
import { Setup } from "./Setup";
import { WorldView } from "./RegionView";
import { places } from "./world";
import { HouseEditor } from "./HouseEditor";
import { InsulationPanel } from "./InsulationPanel";
import { ConstructionPanel } from "./ConstructionPanel";
import { applyHousingHouseEdit } from "./housing/runtime";
import { HousingUpgrade } from "./HousingPanel";
import type { House } from "./house";
import type { FacilityChoiceKey } from "./FacilityAction";
import { enableHousing, inspectOrder, order, type Game } from "./sim";
import {
  appendSlot,
  branchSlot,
  downloadText,
  exportSlot,
  importSlot,
  LIBRARY_KEY,
  LEGACY_LIBRARY_KEY,
  newId,
  writeLocalCoordinated,
  upgradeHousingSlot,
  type LocalRead,
  type Slot,
  readLocal,
  type Library,
} from "./library";
import { confirmHandbookWrite, handbookWarning } from "./handbookUi";
import "./reform.css";

type View = "setup" | "life" | "house" | "world" | "book";
const pages = [
  { id: "life", label: "暮らし", Icon: Home },
  { id: "house", label: "住まい", Icon: Armchair },
  { id: "world", label: "地域", Icon: MapPinned },
  { id: "book", label: "手帳", Icon: BookOpen },
] as const;
function date(time: number) {
  return (
    Math.floor(time / 1440) +
    1 +
    "日目 " +
    String(Math.floor(time / 60) % 24).padStart(2, "0") +
    ":" +
    String(time % 60).padStart(2, "0")
  );
}

export default function ReformApp() {
  const [initial] = useState(readLocal);
  const [library, setLibrary] = useState(initial.library),
    [warning, setWarning] = useState(() =>
      handbookWarning(initial, initial.library.activeId !== null),
    );
  const visible = useRef(initial.library);
  const witness = useRef(initial);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [view, setView] = useState<View>(
    initial.library.activeId ? "life" : "setup",
  );
  const [selected, setSelected] = useState(""),
    [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const slot = library.slots.find((s) => s.id === library.activeId);
  const game = slot?.game,
    actor =
      game?.actors.find((a) => a.person.id === selected) ?? game?.actors[0];
  const slotId = slot?.id;
  const actorId = actor?.person.id;
  const [facilitySelection, setFacilitySelection] = useState<{
    slotId: string | undefined;
    actorId: string | undefined;
    choices: Partial<Record<FacilityChoiceKey, string>>;
  }>({ slotId, actorId, choices: {} });
  // A different active save or resident starts with automatic choices.
  if (
    facilitySelection.slotId !== slotId ||
    facilitySelection.actorId !== actorId
  )
    setFacilitySelection({ slotId, actorId, choices: {} });
  function show(next: View) {
    setView(next);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function install(next: Library) {
    visible.current = next;
    setLibrary(next);
  }
  function recover(latest: LocalRead) {
    // An unavailable read has no witnesses. Keep the displayed/exportable copy.
    if (latest.raw === null && latest.legacyRaw === undefined) {
      setWarning(handbookWarning(latest, visible.current.activeId !== null));
      return;
    }
    witness.current = latest;
    if (latest.blocked) {
      setWarning(handbookWarning(latest, visible.current.activeId !== null));
      return;
    }
    install(latest.library);
    setWarning(
      [
        "別のタブで手帳が変更されました。最新の内容を確認してから、もう一度操作してください。",
        latest.warning,
      ]
        .filter(Boolean)
        .join(" "),
    );
    setNotice("");
  }
  useEffect(() => {
    function sync(e: StorageEvent) {
      if (
        e.key !== null &&
        e.key !== LIBRARY_KEY &&
        e.key !== LEGACY_LIBRARY_KEY
      )
        return;
      const latest = readLocal();
      if (e.key === LEGACY_LIBRARY_KEY && latest.raw !== null) return;
      const previous = witness.current;
      if (
        latest.raw === previous.raw &&
        latest.legacyRaw === previous.legacyRaw &&
        latest.blocked === previous.blocked &&
        latest.warning === previous.warning
      )
        return;
      recover(latest);
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  async function save(next: Library): Promise<boolean> {
    // An event can arrive before React has committed the newest render.
    if (writing.current) return false;
    if (visible.current !== library) {
      setNotice(
        "手帳の内容が変わりました。最新の内容を確認して、もう一度操作してください。",
      );
      return false;
    }
    const expected = witness.current;
    writing.current = true;
    setPending(true);
    try {
      const result = confirmHandbookWrite(
        await writeLocalCoordinated(next, expected.raw, expected.legacyRaw),
      );
      if (result.status === "saved") {
        witness.current = {
          library: next,
          raw: result.raw,
          warning: "",
          blocked: false,
        };
        install(next);
        setWarning(result.warning ?? "");
        return true;
      }
      if (result.status === "invalid") setNotice(result.warning);
      else if (result.status === "unavailable")
        setWarning(
          handbookWarning(
            witness.current.blocked ? witness.current : "unavailable",
            visible.current.activeId !== null,
          ),
        );
      else recover(result.latest);
      return false;
    } finally {
      writing.current = false;
      setPending(false);
    }
  }
  async function begin(g: Game, name: string) {
    const enabled = enableHousing(g, "new");
    const created = {
      id: newId(),
      name,
      game: enabled,
      origin: structuredClone(enabled),
    };
    if (await save(appendSlot(library, created))) {
      setSelected(enabled.actors[0].person.id);
      show("life");
    }
  }
  async function update(g: Game) {
    if (!slot) return false;
    return save({
      ...library,
      slots: library.slots.map((s) =>
        s.id === slot.id ? { ...s, game: g } : s,
      ),
    });
  }
  async function build(house: House) {
    if (!game) return;
    const result = applyHousingHouseEdit(game, house);
    if (result.error) {
      setNotice(result.error);
      return;
    }
    if (await update(result.game)) {
      const cost = game.wood - result.game.wood;
      setNotice(
        cost
          ? "住まいを整えました。木材" + cost + "を使いました。"
          : "間取りに反映しました。",
      );
    }
  }
  async function upgrade() {
    if (!slot || slot.game.housing) return;
    let entry: Slot;
    try {
      entry = upgradeHousingSlot(slot, slot.name + "／住居の移動");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "元の暮らしを旧方式で続けてください。",
      );
      return;
    }
    if (await save(appendSlot(library, entry))) {
      show("life");
      setNotice(
        "元の暮らしを手帳に残しました。新しい指示から家の中を移動します。",
      );
    }
  }
  async function branch(origin: boolean) {
    if (!slot) return;
    const entry = branchSlot(
      slot,
      origin,
      slot.name.split("／")[0] + "／分岐" + (library.slots.length + 1),
    );
    if (await save(appendSlot(library, entry))) {
      show("life");
      setNotice("元の暮らしを手帳に残し、別の暮らしを開きました。");
    }
  }
  async function readFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 8_000_000)
        throw new Error("8MB以内の新版の保存を選んでください。");
      const entry = importSlot(await file.text());
      if (await save(appendSlot(library, entry))) {
        setSelected(entry.game.actors[0].person.id);
        show("life");
        setNotice("手帳に保存を追加しました。");
      }
    } catch (err) {
      setNotice(
        err instanceof SyntaxError
          ? "JSONとして読み取れませんでした。"
          : err instanceof Error
            ? err.message
            : "保存を読み取れませんでした。",
      );
    }
  }
  const activeView =
    view !== "setup" && view !== "book" && !game ? "setup" : view;
  return (
    <fieldset className="rf-app" disabled={pending} aria-busy={pending}>
      {pending && (
        <div role="status" className="rf-saving">
          手帳に保存しています…
        </div>
      )}
      <header className="rf-mast">
        <div className="rf-mast-inner">
          <div className="rf-brand">
            <span className="rf-seal">
              <Leaf size={23} strokeWidth={1.5} />
            </span>
            余白の暮らし
          </div>
          {(activeView === "setup" || !game) && (
            <button
              className="rf-book-link"
              onClick={() => show(activeView === "book" ? "setup" : "book")}
            >
              <BookMarked size={17} />
              {activeView === "book" ? "最初の朝" : "手帳"}
            </button>
          )}
        </div>
      </header>
      {game && activeView !== "setup" && (
        <nav className="rf-navigation" aria-label="暮らしの画面">
          <div className="rf-navigation-inner">
            {pages.map(({ id, label, Icon }) => (
              <button
                key={id}
                aria-current={activeView === id ? "page" : undefined}
                onClick={() => show(id)}
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}
      {warning && (
        <div className="rf-alert" role="alert">
          {warning}
        </div>
      )}
      {notice && (
        <div className="rf-notice" role="status">
          {notice}
        </div>
      )}
      {activeView === "setup" && (
        <Setup
          onBegin={begin}
          onNotebook={() => show("book")}
          onCancel={slot ? () => show("life") : undefined}
        />
      )}
      {activeView === "life" && game && actor && (
        <main className="rf-main rf-main-life">
          <Life
            key={slot?.id}
            game={game}
            selected={actor.person.id}
            onSelect={setSelected}
            onGame={update}
            facilitySelection={{
              choices: facilitySelection.choices,
              choose: (key, id) =>
                setFacilitySelection((previous) => ({
                  ...previous,
                  choices: { ...previous.choices, [key]: id },
                })),
            }}
          />
        </main>
      )}
      {activeView === "house" && game && (
        <main className="rf-main rf-page rf-main-house">
          <div className="rf-page-title">
            <div>
              <p>{places(game.world).find((p) => p.id === game.home)?.name}</p>
              <h1>住まい</h1>
            </div>
          </div>
          <ConstructionPanel
            key={`construction:${slot?.id}`}
            game={game}
            onGame={update}
          />
          <InsulationPanel
            key={`insulation:${slot?.id}`}
            game={game}
            onGame={update}
          />
          <HouseEditor
            key={`house-editor:${slot?.id}`}
            house={game.house}
            allowRoomAddition={false}
            waterMinutes={
              places(game.world).find((p) => p.id === game.home)?.water ?? 0
            }
            onChange={build}
          />
        </main>
      )}
      {activeView === "world" && game && actor && (
        <main className="rf-main rf-page rf-main-world">
          <div className="rf-page-title">
            <div>
              <p>旅と地域の営み</p>
              <h1>地域</h1>
            </div>
            <label>
              行動する人
              <select
                value={actor.person.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {game.actors.map((a) => (
                  <option key={a.person.id} value={a.person.id}>
                    {a.person.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <WorldView
            world={game.world}
            location={actor.location}
            preview={(kind, target) =>
              inspectOrder(game, actor.person.id, kind, target)
            }
            onTravel={async (id) => {
              const g = order(game, actor.person.id, "travel", id);
              if (await update(g)) show("life");
            }}
            onProject={async (cmd) => {
              const g = order(game, actor.person.id, "project", cmd);
              if (await update(g)) show("life");
            }}
          />
        </main>
      )}
      {activeView === "book" && (
        <main className="rf-main rf-page rf-book">
          <div className="rf-page-title">
            <div>
              <p>保存と再開</p>
              <h1>暮らしの手帳</h1>
            </div>
            <Notebook size={35} strokeWidth={1.2} />
          </div>
          {slot && (
            <section className="rf-paper">
              <h2>{slot.name}</h2>
              <p>
                {date(slot.game.time)}　
                {slot.game.actors.map((a) => a.person.name).join("・")}
              </p>
              <div className="rf-buttons">
                <button onClick={() => branch(true)}>
                  <Sprout size={16} />
                  同じ朝から分岐
                </button>
                <button onClick={() => branch(false)}>
                  <GitBranch size={16} />
                  今の時点から分岐
                </button>
              </div>
              <HousingUpgrade game={slot.game} onUpgrade={upgrade} />
              <p className="rf-hint">
                分岐前の暮らしも、この手帳から再開できます。
              </p>
              <div className="rf-buttons">
                <button
                  onClick={() =>
                    downloadText(
                      exportSlot(slot),
                      "余白の暮らし-" + slot.name + ".json",
                    )
                  }
                >
                  <Download size={16} />
                  保存を書き出す
                </button>
                <button
                  onClick={() =>
                    downloadText(
                      exportSlot({ ...slot, game: slot.origin }),
                      "同じ朝-" + slot.name + ".json",
                    )
                  }
                >
                  <Flag size={16} />
                  最初の朝を書き出す
                </button>
              </div>
            </section>
          )}
          <section className="rf-paper">
            <h2>保存した暮らし</h2>
            {library.slots.length === 0 && (
              <p>初めて迎えた朝はここに保存されます。</p>
            )}
            <ul className="rf-slots">
              {library.slots.map((s) => (
                <li key={s.id}>
                  <button
                    aria-current={s.id === slot?.id ? "true" : undefined}
                    onClick={async () => {
                      if (await save({ ...library, activeId: s.id })) {
                        setSelected(s.game.actors[0].person.id);
                        show("life");
                      }
                    }}
                  >
                    <span>{s.name}</span>
                    <small>
                      {date(s.game.time)}
                      {s.id === slot?.id ? "　現在" : ""}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
            <div className="rf-buttons">
              <button onClick={() => show("setup")}>
                <Plus size={16} />
                新しい暮らしをつくる
              </button>
              <button onClick={() => input.current?.click()}>
                <Upload size={16} />
                保存を読み込む
              </button>
            </div>
            <input
              ref={input}
              type="file"
              accept=".json,application/json"
              aria-label="新版の保存ファイル"
              hidden
              onChange={readFile}
            />
          </section>
          <a className="rf-archive" href="./yohaku-v53.html">
            公開53の暮らしを開く
          </a>
        </main>
      )}
      <footer
        className={
          activeView === "life" && game ? "rf-foot rf-foot-life" : "rf-foot"
        }
      >
        <span>余白の暮らし</span>
        <a href="./yohaku-v53.html">公開53</a>
      </footer>
    </fieldset>
  );
}
