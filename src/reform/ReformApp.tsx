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
import { houseValue, type House } from "./house";
import { inspectOrder, order, type Game } from "./sim";
import {
  appendSlot,
  branchSlot,
  downloadText,
  exportSlot,
  importSlot,
  LIBRARY_KEY,
  newId,
  parseLibrary,
  readLocal,
  type Library,
  type Slot,
} from "./library";
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
    [warning, setWarning] = useState(initial.warning);
  const current = useRef(initial.library),
    savedRaw = useRef(initial.raw),
    blocked = useRef(initial.blocked);
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
  function show(next: View) {
    setView(next);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function install(next: Library) {
    current.current = next;
    setLibrary(next);
  }
  useEffect(() => {
    function sync(e: StorageEvent) {
      if (e.key !== LIBRARY_KEY || !e.newValue) return;
      try {
        const next = parseLibrary(e.newValue);
        savedRaw.current = e.newValue;
        blocked.current = false;
        install(next);
        setNotice("別のタブで保存した暮らしを読み込みました。");
      } catch {
        setWarning(
          "別のタブの保存を確認できませんでした。この手帳は書き出して保管できます。",
        );
        blocked.current = true;
      }
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function save(next: Library): boolean {
    if (!blocked.current) {
      try {
        const previous = localStorage.getItem(LIBRARY_KEY);
        if (previous !== savedRaw.current) {
          if (previous) {
            const updated = parseLibrary(previous);
            install(updated);
            savedRaw.current = previous;
          }
          setWarning(
            "別のタブの保存に切り替わりました。内容を確認してからもう一度操作してください。",
          );
          return false;
        }
        const json = JSON.stringify(next);
        localStorage.setItem(LIBRARY_KEY, json);
        savedRaw.current = json;
        setWarning("");
      } catch {
        setWarning(
          "端末に保存できませんでした。手帳の「保存を書き出す」からこの暮らしを保管してください。",
        );
      }
    }
    install(next);
    return true;
  }
  function begin(g: Game, name: string) {
    const created = { id: newId(), name, game: g, origin: structuredClone(g) };
    if (save(appendSlot(current.current, created))) {
      setSelected(g.actors[0].person.id);
      show("life");
    }
  }
  function update(g: Game) {
    if (!slot) return;
    save({
      ...current.current,
      slots: current.current.slots.map((s) =>
        s.id === slot.id ? { ...s, game: g } : s,
      ),
    });
  }
  function build(house: House) {
    if (!game) return;
    for (const resident of game.actors) {
      const reserved = resident.task?.station?.split("#")[0];
      if (!reserved) continue;
      const before = game.house.rooms.find((r) =>
        r.fixtures.some((f) => f.id === reserved),
      );
      const after = house.rooms.find((r) =>
        r.fixtures.some((f) => f.id === reserved),
      );
      if (
        before?.id !== after?.id ||
        before?.fixtures.find((f) => f.id === reserved)?.cell !==
          after?.fixtures.find((f) => f.id === reserved)?.cell
      ) {
        setNotice(
          resident.person.name +
            "がこの設備を使用中です。終えてから移設できます。",
        );
        return;
      }
    }
    const cost = Math.max(0, houseValue(house) - houseValue(game.house));
    if (cost > game.wood) {
      setNotice(
        "工事には木材" +
          cost +
          "が必要です。共同の備蓄は" +
          game.wood +
          "です。",
      );
      return;
    }
    const g = {
      ...game,
      house,
      wood: game.wood - cost,
      log: [
        date(game.time) +
          "　住まいを整えた" +
          (cost ? "（木材" + cost + "）" : ""),
        ...game.log,
      ].slice(0, 100),
    };
    update(g);
    setNotice(
      cost
        ? "住まいを整えました。木材" + cost + "を使いました。"
        : "間取りに反映しました。",
    );
  }
  function branch(origin: boolean) {
    if (!slot) return;
    const entry = branchSlot(
      slot,
      origin,
      slot.name.split("／")[0] + "／分岐" + (library.slots.length + 1),
    );
    if (save(appendSlot(current.current, entry))) {
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
        throw new Error("8MB以内の改革版の保存を選んでください。");
      const entry = importSlot(await file.text());
      if (save(appendSlot(current.current, entry))) {
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
    <div className="rf-app">
      <header className="rf-mast">
        <div className="rf-mast-inner">
          <div className="rf-brand">
            <span className="rf-seal">
              <Leaf size={23} strokeWidth={1.5} />
            </span>
            余白の暮らし
          </div>
          {activeView !== "setup" && game ? (
            <span className="rf-mast-date">{date(game.time)}</span>
          ) : (
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
        <main className="rf-main">
          <Life
            game={game}
            selected={actor.person.id}
            onSelect={setSelected}
            onGame={update}
          />
        </main>
      )}
      {activeView === "house" && game && (
        <main className="rf-main rf-page">
          <div className="rf-page-title">
            <div>
              <p>{places(game.world).find((p) => p.id === game.home)?.name}</p>
              <h1>住まい</h1>
            </div>
            <span>木材 {game.wood}</span>
          </div>
          <HouseEditor
            house={game.house}
            waterMinutes={
              places(game.world).find((p) => p.id === game.home)?.water ?? 0
            }
            onChange={build}
          />
        </main>
      )}
      {activeView === "world" && game && actor && (
        <main className="rf-main rf-page">
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
            onTravel={(id) => {
              const g = order(game, actor.person.id, "travel", id);
              update(g);
              show("life");
            }}
            onProject={(cmd) => {
              const g = order(game, actor.person.id, "project", cmd);
              update(g);
              show("life");
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
                    onClick={() => {
                      if (save({ ...current.current, activeId: s.id })) {
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
              aria-label="改革版の保存ファイル"
              hidden
              onChange={readFile}
            />
          </section>
          <a className="rf-archive" href="./yohaku-v53.html">
            公開53の暮らしを開く
          </a>
        </main>
      )}
      <footer className="rf-foot">
        <span>余白の暮らし</span>
        <a href="./yohaku-v53.html">公開53</a>
      </footer>
    </div>
  );
}
