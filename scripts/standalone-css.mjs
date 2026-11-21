function skipString(css, start) {
  const quote = css[start];
  for (let i = start + 1; i < css.length; i++) {
    if (css[i] === "\\") i++;
    else if (css[i] === quote) return i + 1;
  }
  return css.length;
}

function skipComment(css, start) {
  const end = css.indexOf("*/", start + 2);
  return end < 0 ? css.length : end + 2;
}

function importEnd(css, start) {
  let parentheses = 0;
  for (let i = start; i < css.length; i++) {
    const char = css[i];
    if (char === '"' || char === "'") i = skipString(css, i) - 1;
    else if (char === "/" && css[i + 1] === "*") i = skipComment(css, i) - 1;
    else if (char === "\\") i++;
    else if (char === "(") parentheses++;
    else if (char === ")") parentheses = Math.max(0, parentheses - 1);
    else if (char === ";" && parentheses === 0) return i + 1;
    // Do not swallow a following rule if an invalid import lacks its terminator.
    else if (char === "{" && parentheses === 0) return -1;
  }
  return -1;
}

/** Remove complete external CSS imports without cutting at URL query semicolons. */
export function stripCssImports(css) {
  let output = "";
  let retainedFrom = 0;
  let depth = 0;
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (char === '"' || char === "'") i = skipString(css, i) - 1;
    else if (char === "/" && css[i + 1] === "*") i = skipComment(css, i) - 1;
    else if (char === "\\") i++;
    else if (char === "{") depth++;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /^@import\b/i.test(css.slice(i, i + 8))) {
      const end = importEnd(css, i + 7);
      if (end < 0) continue;
      output += css.slice(retainedFrom, i);
      retainedFrom = end;
      i = end - 1;
    }
  }
  return output + css.slice(retainedFrom);
}
