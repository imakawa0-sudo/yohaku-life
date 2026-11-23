import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyLibrary,
  LIBRARY_KEY,
  readLocal,
  writeLocal,
} from "../src/reform/library";
import {
  confirmHandbookWrite,
  handbookWarning,
} from "../src/reform/handbookUi";

function withStorage(check: (values: Map<string, string>) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  try {
    check(values);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}
test("superseded success and stale conflict adopt current bytes before a storage event", () => {
  withStorage((values) => {
    const saved = writeLocal(emptyLibrary(), null, null);
    assert.equal(saved.status, "saved");
    assert.deepEqual(confirmHandbookWrite(saved), saved);
    const second = saved.raw + " ";
    values.set(LIBRARY_KEY, second);
    const conflict = writeLocal(emptyLibrary(), saved.raw);
    assert.equal(conflict.status, "conflict");
    const third = second + " ";
    values.set(LIBRARY_KEY, third);
    for (const response of [saved, conflict]) {
      const latest = confirmHandbookWrite(response);
      assert.equal(latest.status, "conflict");
      assert.equal(latest.latest.raw, third);
      assert.equal(values.get(LIBRARY_KEY), third);
    }
    values.set(LIBRARY_KEY, "{");
    const blocked = confirmHandbookWrite(saved);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.latest.raw, "{");
    assert.equal(values.get(LIBRARY_KEY), "{");
    const visible = handbookWarning(blocked.latest, true);
    assert.match(visible, /元の保存を保護/);
    assert.match(visible, /手帳の「保存を書き出す」/);
    assert.match(visible, /別のブラウザ/);
    values.delete(LIBRARY_KEY);
    const removed = confirmHandbookWrite(blocked);
    assert.equal(removed.status, "conflict");
    assert.equal(removed.latest.raw, null);
    assert.equal(removed.latest.legacyRaw, null);
  });
});
test("failed first save explains retry without offering export of an uninstalled proposal", () => {
  withStorage((values) => {
    const write = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("quota");
    };
    const failure = writeLocal(emptyLibrary(), null, null);
    assert.equal(failure.status, "unavailable");
    assert.equal(confirmHandbookWrite(failure), failure);
    assert.equal(values.get(LIBRARY_KEY), undefined);
    assert.match(handbookWarning("unavailable", false), /もう一度/);
    assert.doesNotMatch(handbookWarning("unavailable", false), /保存を書き出/);
    assert.match(
      handbookWarning("unavailable", true),
      /手帳の「保存を書き出す」/,
    );
    localStorage.setItem = write;
    assert.equal(
      confirmHandbookWrite(writeLocal(emptyLibrary(), null, null)).status,
      "saved",
    );
  });
  withStorage(() => {
    const saved = writeLocal(emptyLibrary(), null, null);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw Error("unavailable");
      },
    });
    const unreadable = confirmHandbookWrite(saved);
    assert.equal(unreadable.status, "unavailable");
    assert.match(handbookWarning(readLocal(), true), /表示中の暮らし/);
  });
});
