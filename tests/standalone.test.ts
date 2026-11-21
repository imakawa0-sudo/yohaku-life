import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { stripCssImports } from "../scripts/standalone-css.mjs";

const rootRule = ":root{--paper:#fffef9;--olive:#65754f;color:var(--olive)}";
const fonts =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;450;500;550;600;650;700&family=Noto+Serif+JP:wght@400;500;600;650;700&display=swap";

test("Standalone removes the complete minified quoted Google Fonts import and preserves root variables", () => {
  assert.equal(stripCssImports(`@import"${fonts}";${rootRule}`), rootRule);
  assert.equal(stripCssImports(`@import '${fonts}';${rootRule}`), rootRule);
});

test("Standalone removes url imports with semicolons, quotes, comments and optional import conditions", () => {
  for (const source of [
    `@import url("${fonts}");`,
    `@import url('${fonts}');`,
    `@import url(${fonts});`,
    `@IMPORT/**/url("${fonts}") layer(fonts) supports(font-format("semi;colon")) screen;`,
    `@import "https://example.com/escaped\\\";font.css";`,
  ])
    assert.equal(stripCssImports(source + rootRule), rootRule, source);
});

test("Standalone preserves comments, content strings and every rule following multiple imports", () => {
  const comment = '/* @import "keep;this comment"; */';
  const content = '.note::before{content:"@import \\\"keep;this\\\";"}';
  const css = `${comment}\n@import "one;two.css";\n@import url(three;four.css);\n${rootRule}${content}`;
  assert.equal(stripCssImports(css), `${comment}\n\n\n${rootRule}${content}`);
  assert.equal(stripCssImports(rootRule + content), rootRule + content);
});

test("The actual compiled game CSS starts at :root and retains its custom properties without network imports", async () => {
  // Compile the current source, so this regression also runs before dist exists.
  const source = await readFile(
    new URL("../src/styles.css", import.meta.url),
    "utf8",
  );
  const compiled = await transform(source, { loader: "css", minify: true });
  assert.ok(compiled.code.startsWith('@import"https://fonts.googleapis.com/'));
  const offline = stripCssImports(compiled.code);
  assert.ok(offline.startsWith(":root{"), offline.slice(0, 180));
  assert.match(offline, /--paper:\s*#fffef9/);
  assert.match(offline, /--olive:\s*#65754f/);
  assert.doesNotMatch(offline, /@import\b/i);
  assert.doesNotMatch(offline, /fonts\.googleapis\.com/);
  const validated = await transform(offline, { loader: "css", minify: true });
  assert.equal(validated.warnings.length, 0);
});
