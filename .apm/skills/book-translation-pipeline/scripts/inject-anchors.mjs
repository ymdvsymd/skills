#!/usr/bin/env node
// EPUB の各 xhtml から id を抽出し、対応する Markdown 上の位置にアンカー定義を注入する。
//
// 注入先:
//   - figure (画像行) ... `![](../images/X.png)` の直前に `<a id="figId"></a>`
//   - table  (Markdown table 行) ... `| ... |` の直前に `<a id="tableId"></a>`
//   - heading (見出し行末尾) ... `## Title` → `## Title {#headingId}`
//
// docs/en と docs/ja の両方に idempotent に適用する (二度走らせても重複しない)。
// extract-epub.mjs が拾えなかった id (章冒頭 figure / 一部 sect 見出し等) を補完する目的。
//
// 使い方:
//   node scripts/inject-anchors.mjs               # 本番適用
//   node scripts/inject-anchors.mjs --dry-run     # 件数のみ
//   node scripts/inject-anchors.mjs --en-only     # docs/en のみ
//   node scripts/inject-anchors.mjs --ja-only     # docs/ja のみ
//   node scripts/inject-anchors.mjs --verbose     # 詳細ログ

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filenameMap } from './lib/filename-map.mjs';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const EPUB_PATH = join(REPO_ROOT, 'docs', 'apwp.epub');
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const EN_ONLY = process.argv.includes('--en-only');
const JA_ONLY = process.argv.includes('--ja-only');
const TARGET_DIRS = EN_ONLY ? ['docs/en'] : (JA_ONLY ? ['docs/ja'] : ['docs/en', 'docs/ja']);

// O'Reilly EPUB の ephemeral id (idmNNN suffix なし) は本文中で参照されないので注入対象外
function isEphemeralId(id) {
  return /^idm\d+$/.test(id);
}

function stripTags(s) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// コードブロック (```...```) 内の `# ...` (コメント行) を見出しと誤検知しないように、
// コードブロック範囲を改行のみに置換した sanitized 版を返す。位置情報は保つ。
function stripCodeBlocks(content) {
  return content.replace(/^```[\s\S]*?^```$/gm, (block) => {
    const lineCount = block.split('\n').length;
    return '\n'.repeat(lineCount - 1);
  });
}

// 見出し行を [{ level, text, id }] にパース。`{#id}` の有無を確実に分離する。
function parseHeadings(content) {
  const sanitized = stripCodeBlocks(content);
  const out = [];
  for (const m of sanitized.matchAll(/^(#+)\s+(.+)$/gm)) {
    const level = m[1].length;
    const fullText = m[2].trim();
    const idM = fullText.match(/\s*\{#([a-zA-Z_][a-zA-Z0-9_-]*)\}\s*$/);
    if (idM) {
      const text = fullText.slice(0, idM.index).trim();
      out.push({ level, text, id: idM[1] });
    } else {
      out.push({ level, text: fullText, id: null });
    }
  }
  return out;
}

// EPUB を /tmp に一時展開して各 xhtml の絶対パスを返す
function unzipEpub() {
  const tmpDir = spawnSync('mktemp', ['-d', '-t', 'inject-anchors-XXXXX'], { encoding: 'utf-8' }).stdout.trim();
  const r = spawnSync('unzip', ['-o', EPUB_PATH, '-d', tmpDir], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`unzip failed: status ${r.status}`);
  return tmpDir;
}

function resolveOpfPath(tmpDir) {
  const containerXml = readFileSync(join(tmpDir, 'META-INF', 'container.xml'), 'utf-8');
  const m = containerXml.match(/<rootfile[^>]+full-path="([^"]+)"/);
  if (!m) throw new Error('container.xml: no rootfile full-path');
  const opfPath = join(tmpDir, m[1]);
  return { opfPath, oebpsDir: opfPath.replace(/\/[^/]+$/, '') };
}

// xhtml stem ('ch04') -> oebpsDir 内の絶対パス
function buildXhtmlPathMap(opfPath, oebpsDir) {
  const xml = readFileSync(opfPath, 'utf-8');
  const map = new Map();
  for (const m of xml.matchAll(/<item\b([^>]+)>/g)) {
    const attrs = m[1];
    const idM = attrs.match(/\bid="([^"]+)"/);
    const hrefM = attrs.match(/\bhref="([^"]+)"/);
    if (!idM || !hrefM) continue;
    const stem = idM[1];
    const xhtmlPath = join(oebpsDir, hrefM[1]);
    if (filenameMap[stem] && filenameMap[stem] !== 'SKIP') {
      map.set(stem, xhtmlPath);
    }
  }
  return map;
}

// 各 xhtml の id 情報を収集
function collectIds(xhtml) {
  const figureMap = new Map();    // imgBasename -> id
  const tableIds = [];             // 出現順 [{ id }]
  const headings = [];             // 出現順 [{ id, cls, enText }]
  const sidebars = [];             // 出現順 [{ id, enText }]

  // figure: <div id="..." class="figure">...<img src="..."> または class が先・id が先の両方を許容
  const figRe1 = /<div\s+(?:[^>]*\s+)?id="([^"]+)"[^>]*\bclass="figure"[^>]*>[\s\S]*?<img[^>]*\bsrc="([^"]+)"/g;
  const figRe2 = /<div\s+(?:[^>]*\s+)?class="figure"[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<img[^>]*\bsrc="([^"]+)"/g;
  for (const re of [figRe1, figRe2]) {
    for (const m of xhtml.matchAll(re)) {
      const id = m[1];
      const imgBn = basename(m[2]);
      if (!isEphemeralId(id) && !figureMap.has(imgBn)) {
        figureMap.set(imgBn, id);
      }
    }
  }

  // table: <table id="...">
  for (const m of xhtml.matchAll(/<table[^>]*\bid="([^"]+)"/g)) {
    if (!isEphemeralId(m[1])) tableIds.push({ id: m[1] });
  }

  // heading: <div class="(chapter|preface|sect[1-3]|...part...)" id="..."> 直後の <h[1-6]>
  const bodyM = xhtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyM ? bodyM[1] : xhtml;
  const divHeadingRe = /<div[^>]*\bid="([^"]+)"[^>]*\bclass="([^"]+)"[^>]*>[\s\S]*?<h([1-6])[^>]*>([\s\S]*?)<\/h\3>|<div[^>]*\bclass="([^"]+)"[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<h([1-6])[^>]*>([\s\S]*?)<\/h\7>/g;
  for (const m of body.matchAll(divHeadingRe)) {
    const id = m[1] || m[6];
    const cls = m[2] || m[5];
    const hText = stripTags(m[4] || m[8]);
    if (isEphemeralId(id)) continue;
    if (!/(chapter|preface|sect[0-9]|part)/.test(cls)) continue;
    headings.push({ id, cls, enText: hText });
  }

  // sidebar: <div class="sidebar" id="..."><h5>Title</h5> または id と class が逆順
  const sidebarRe1 = /<div\s+(?:[^>]*\s+)?class="sidebar"[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/g;
  const sidebarRe2 = /<div\s+(?:[^>]*\s+)?id="([^"]+)"[^>]*\bclass="sidebar"[^>]*>[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/g;
  for (const re of [sidebarRe1, sidebarRe2]) {
    for (const m of body.matchAll(re)) {
      const id = m[1];
      const titleText = stripTags(m[2]);
      if (!isEphemeralId(id) && !sidebars.find(s => s.id === id)) {
        sidebars.push({ id, enText: titleText });
      }
    }
  }

  return { figureMap, tableIds, headings, sidebars };
}

// MD ファイルに注入 (figure / table / heading-en)
function injectIntoMd(path, info, lang) {
  if (!existsSync(path)) return { added: 0 };
  const before = readFileSync(path, 'utf-8');
  let content = before;
  let added = 0;

  // 1. figure: 画像行直前に <a id="..."></a>
  for (const [imgBn, id] of info.figureMap) {
    if (content.includes(`id="${id}"`)) continue;
    const imgRe = new RegExp(`^(!\\[[^\\]]*\\]\\(\\.\\./images/${escapeRegExp(imgBn)}\\))$`, 'm');
    if (!imgRe.test(content)) continue;
    content = content.replace(imgRe, `<a id="${id}"></a>\n\n$1`);
    added++;
    if (VERBOSE) console.log(`     figure ${id} -> before ${imgBn}`);
  }

  // 2. table: 出現順で対応する table 行直前に <a id="..."></a>
  if (info.tableIds.length > 0) {
    const remainingTableIds = info.tableIds.filter(t => !content.includes(`id="${t.id}"`));
    if (remainingTableIds.length > 0) {
      const lines = content.split('\n');
      const tableRowIndices = [];
      for (let i = 0; i < lines.length; i++) {
        if (/^\|[^|]*\|/.test(lines[i]) && (i + 1 < lines.length) && /^\|[\s|:-]+\|$/.test(lines[i + 1])) {
          let hasAnchor = false;
          for (let j = Math.max(0, i - 5); j < i; j++) {
            if (/<a id="/.test(lines[j])) { hasAnchor = true; break; }
          }
          if (!hasAnchor) tableRowIndices.push(i);
        }
      }
      const pairs = [];
      for (let k = 0; k < Math.min(remainingTableIds.length, tableRowIndices.length); k++) {
        pairs.push({ id: remainingTableIds[k].id, rowIdx: tableRowIndices[k] });
      }
      pairs.sort((a, b) => b.rowIdx - a.rowIdx);
      for (const { id, rowIdx } of pairs) {
        lines.splice(rowIdx, 0, `<a id="${id}"></a>`, '');
        added++;
        if (VERBOSE) console.log(`     table ${id} -> before line ${rowIdx + 1}`);
      }
      content = lines.join('\n');
    }
  }

  // 3. heading (en のみ): 英文テキストで照合して {#id} 追記
  if (lang === 'en' && info.headings.length > 0) {
    for (const h of info.headings) {
      if (content.match(new RegExp(`\\{#${escapeRegExp(h.id)}\\}`))) continue;
      const headRe = new RegExp(`^(#+\\s+${escapeRegExp(h.enText)})\\s*$`, 'm');
      if (headRe.test(content)) {
        content = content.replace(headRe, `$1 {#${h.id}}`);
        added++;
        if (VERBOSE) console.log(`     heading(en) ${h.id} -> "${h.enText}"`);
      }
    }
  }

  // 4. sidebar (en のみ): `> **Title**` 行直前に <a id="..."></a> を挿入
  if (lang === 'en' && info.sidebars && info.sidebars.length > 0) {
    for (const sb of info.sidebars) {
      if (content.includes(`id="${sb.id}"`)) continue;
      const blockRe = new RegExp(`^(>\\s+\\*\\*${escapeRegExp(sb.enText)}\\*\\*)\\s*$`, 'm');
      if (blockRe.test(content)) {
        content = content.replace(blockRe, `<a id="${sb.id}"></a>\n\n$1`);
        added++;
        if (VERBOSE) console.log(`     sidebar(en) ${sb.id} -> "${sb.enText}"`);
      }
    }
  }

  if (added > 0 && !DRY_RUN && content !== before) writeFileSync(path, content, 'utf-8');
  return { added };
}

// ja の heading 注入 (位置ベース): en MD で見出し→id を抽出して ja の同じ位置に注入
function applyJaHeadingsByPosition(jaPath, enPath) {
  if (!existsSync(jaPath) || !existsSync(enPath)) return { added: 0 };
  const enContent = readFileSync(enPath, 'utf-8');
  const jaContent = readFileSync(jaPath, 'utf-8');

  const enHeadings = parseHeadings(enContent);
  const jaHeadings = parseHeadings(jaContent);
  // 先頭から見出しレベルが一致する範囲だけ注入対象とする (mismatch 以降は skip)
  let lastMatchIdx = -1;
  const minLen = Math.min(enHeadings.length, jaHeadings.length);
  for (let i = 0; i < minLen; i++) {
    if (enHeadings[i].level === jaHeadings[i].level) lastMatchIdx = i;
    else break;
  }
  if (enHeadings.length !== jaHeadings.length) {
    console.warn(`  ⚠  ${jaPath}: heading count mismatch (en=${enHeadings.length}, ja=${jaHeadings.length}) — only first ${lastMatchIdx + 1} heading(s) eligible`);
  } else if (lastMatchIdx + 1 < enHeadings.length) {
    const i = lastMatchIdx + 1;
    console.warn(`  ⚠  ${jaPath}: heading level mismatch at index ${i} (en=${enHeadings[i].level}, ja=${jaHeadings[i].level}) — only first ${lastMatchIdx + 1} heading(s) eligible`);
  }

  const lines = jaContent.split('\n');
  const headingByLine = new Map();
  let headingIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^#+\s+/.test(lines[i])) {
      headingByLine.set(headingIdx, i);
      headingIdx++;
    }
  }

  let added = 0;
  for (let i = 0; i <= lastMatchIdx; i++) {
    if (!enHeadings[i].id) continue;
    if (jaHeadings[i].id) continue;
    const ln = headingByLine.get(i);
    if (ln === undefined) continue;
    const trimmed = lines[ln].replace(/\s+$/, '');
    if (trimmed.includes(`{#${enHeadings[i].id}}`)) continue;
    lines[ln] = `${trimmed} {#${enHeadings[i].id}}`;
    added++;
    if (VERBOSE) console.log(`     heading(ja-pos) ${enHeadings[i].id} -> ja line ${ln + 1}`);
  }
  const newContent = lines.join('\n');
  if (added > 0 && !DRY_RUN && newContent !== jaContent) writeFileSync(jaPath, newContent, 'utf-8');
  return { added };
}

// ja 用 sidebar 注入 (位置ベース): en の `> **Title**` 行直前 <a id> を ja の対応位置に注入
function applyJaSidebarsByPosition(jaPath, enPath) {
  if (!existsSync(jaPath) || !existsSync(enPath)) return { added: 0 };
  const enContent = readFileSync(enPath, 'utf-8');
  const jaContent = readFileSync(jaPath, 'utf-8');

  const enLines = enContent.split('\n');
  const jaLines = jaContent.split('\n');

  const isBlockquoteTitle = (line) => /^>\s+\*\*[^*]+\*\*\s*$/.test(line);

  // en の blockquote title 行を順番に取り、各行の直前 5 行内 <a id> を取得
  const enSidebars = [];
  for (let i = 0; i < enLines.length; i++) {
    if (!isBlockquoteTitle(enLines[i])) continue;
    let id = null;
    for (let j = Math.max(0, i - 5); j < i; j++) {
      const idM = enLines[j].match(/<a id="([^"]+)"><\/a>/);
      if (idM) { id = idM[1]; break; }
    }
    enSidebars.push({ lineIdx: i, id });
  }
  // ja の blockquote title 行を順番に取得
  const jaBlockquoteIndices = [];
  for (let i = 0; i < jaLines.length; i++) {
    if (isBlockquoteTitle(jaLines[i])) jaBlockquoteIndices.push(i);
  }

  if (enSidebars.length !== jaBlockquoteIndices.length) {
    if (VERBOSE) console.log(`     sidebar count mismatch: en=${enSidebars.length}, ja=${jaBlockquoteIndices.length} — skip`);
    return { added: 0 };
  }

  const updates = [];
  for (let k = 0; k < enSidebars.length; k++) {
    if (!enSidebars[k].id) continue;
    const id = enSidebars[k].id;
    const targetLineIdx = jaBlockquoteIndices[k];
    let alreadyHas = false;
    for (let j = Math.max(0, targetLineIdx - 5); j < targetLineIdx; j++) {
      if (jaLines[j].includes(`id="${id}"`)) { alreadyHas = true; break; }
    }
    if (!alreadyHas) updates.push({ lineIdx: targetLineIdx, id });
  }
  updates.sort((a, b) => b.lineIdx - a.lineIdx);
  for (const { lineIdx, id } of updates) {
    jaLines.splice(lineIdx, 0, `<a id="${id}"></a>`, '');
  }

  if (updates.length > 0 && !DRY_RUN) {
    writeFileSync(jaPath, jaLines.join('\n'), 'utf-8');
  }
  return { added: updates.length };
}

// === メイン ===
const tmpDir = unzipEpub();
try {
  const { opfPath, oebpsDir } = resolveOpfPath(tmpDir);
  const xhtmlPathMap = buildXhtmlPathMap(opfPath, oebpsDir);

  const stemInfo = new Map();
  for (const [stem, xhtmlPath] of xhtmlPathMap) {
    if (!existsSync(xhtmlPath)) continue;
    const xhtml = readFileSync(xhtmlPath, 'utf-8');
    stemInfo.set(stem, collectIds(xhtml));
  }

  let totalAdded = 0;

  for (const [stem, info] of stemInfo) {
    const mdFile = filenameMap[stem];
    if (!mdFile || mdFile === 'SKIP') continue;

    for (const dir of TARGET_DIRS) {
      const path = join(REPO_ROOT, dir, mdFile);
      if (!existsSync(path)) continue;
      const lang = dir.endsWith('/en') ? 'en' : 'ja';
      const r = injectIntoMd(path, info, lang);
      if (r.added > 0) console.log(`  ${DRY_RUN ? '[DRY] ' : ''}${dir}/${mdFile}: +${r.added} anchor(s)`);
      totalAdded += r.added;
    }
  }

  if (!EN_ONLY) {
    for (const [stem] of stemInfo) {
      const mdFile = filenameMap[stem];
      if (!mdFile || mdFile === 'SKIP') continue;
      const enPath = join(REPO_ROOT, 'docs/en', mdFile);
      const jaPath = join(REPO_ROOT, 'docs/ja', mdFile);
      const rh = applyJaHeadingsByPosition(jaPath, enPath);
      if (rh.added > 0) console.log(`  ${DRY_RUN ? '[DRY] ' : ''}docs/ja/${mdFile}: +${rh.added} heading anchor(s) [ja-position]`);
      totalAdded += rh.added;
      const rs = applyJaSidebarsByPosition(jaPath, enPath);
      if (rs.added > 0) console.log(`  ${DRY_RUN ? '[DRY] ' : ''}docs/ja/${mdFile}: +${rs.added} sidebar anchor(s) [ja-position]`);
      totalAdded += rs.added;
    }
  }

  console.log(`\n${DRY_RUN ? '[DRY] ' : ''}Total: ${totalAdded} anchor(s) injected`);
} finally {
  spawnSync('rm', ['-rf', tmpDir]);
}
