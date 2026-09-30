'use strict';

// Locates the REAL inline <script> elements of an HTML document.
//
// Why this exists: frontend/index.html is ~3.7MB and its comments and JS comments mention the text
// "<script>" in several places (e.g. "// ... a <script> tag ..."). A plain regex such as
// /<script(?![^>]*\bsrc\s*=)([^>]*)>/ treats those mentions as tags. When the server used that regex
// to inject a CSP nonce it silently edited the TEXT of the main 3.6MB application script, which no
// longer matched the sha256 hash in the page's <meta> CSP, so the browser refused to run the whole app
// (React loaded, nothing mounted -> "This is taking longer than it should").
//
// This scanner walks the document the way an HTML parser does: it skips <!-- comments -->, and after
// an opening <script ...> tag it jumps straight to the matching </script> without looking inside.
const OPEN_TAG = /<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>/iy;

function scanInlineScripts(html) {
  const out = [];
  const anyScript = /<script\b/gi;
  let i = 0;
  while (i < html.length) {
    anyScript.lastIndex = i;
    const s = anyScript.exec(html);
    if (!s) break;
    const c = html.indexOf('<!--', i);
    if (c !== -1 && c < s.index) {
      const end = html.indexOf('-->', c + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    OPEN_TAG.lastIndex = s.index;
    const open = OPEN_TAG.exec(html);
    if (!open) { i = s.index + 7; continue; }
    const attrs = open[1] || '';
    const bodyStart = s.index + open[0].length;
    const close = html.slice(bodyStart).search(/<\/script/i);
    const bodyEnd = close === -1 ? html.length : bodyStart + close;
    if (!/\bsrc\s*=/i.test(attrs)) {
      out.push({ tagStart: s.index, tagEnd: bodyStart, attrs, bodyStart, bodyEnd, body: html.slice(bodyStart, bodyEnd) });
    }
    i = bodyEnd;
  }
  return out;
}

// Adds nonce="..." to every real inline <script> opening tag and leaves every other byte alone.
function addNonceToInlineScripts(html, nonce) {
  const scripts = scanInlineScripts(html);
  let result = '';
  let last = 0;
  for (const sc of scripts) {
    result += html.slice(last, sc.tagStart) + `<script nonce="${nonce}"${sc.attrs}>`;
    last = sc.tagEnd;
  }
  return result + html.slice(last);
}

module.exports = { scanInlineScripts, addNonceToInlineScripts };
