import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stripCssImports } from "./standalone-css.mjs";
let html = await readFile("dist/index.html", "utf8");
const jsPath = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/)?.[1];
const cssPath = html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/)?.[1];
if (!jsPath || !cssPath) throw new Error("ビルド成果物を確認してください。");
const js = await readFile(resolve("dist", jsPath.replace(/^\//, "")), "utf8");
const css = await readFile(resolve("dist", cssPath.replace(/^\//, "")), "utf8");
// Fonts fall back to device fonts when offline; all game logic and art are included.
const offlineCss = stripCssImports(css);
html = html.replace(
  /<script[^>]+src="[^"]+"[^>]*><\/script>/,
  () =>
    `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`,
);
html = html.replace(
  /<link[^>]+href="[^"]+\.css"[^>]*>/,
  () => `<style>${offlineCss}</style>`,
);
await writeFile("dist/yohaku.html", html);
console.log("Standalone game: dist/yohaku.html");
