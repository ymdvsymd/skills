#!/usr/bin/env node
// EPUB -> docs/en/ Markdown extraction script (book-translation-pipeline skill template)
//
// 新規プロジェクトでは下記 CONFIG オブジェクトのみを書き換える。
// テンプレートロジック (ヘルパー関数群) は基本変更不要。
//
// 詳細: book-translation-pipeline skill の references/extract-epub-customization.md
//
// 使い方:
//   node scripts/extract-epub.mjs              # 本番抽出
//   node scripts/extract-epub.mjs --dry-run    # 生成ファイル一覧のみ表示
//   node scripts/extract-epub.mjs --keep-tmp   # 一時展開ディレクトリを残す
//
// 依存: Node 組込のみ。EPUB 展開には `unzip` コマンド (macOS/Linux 標準) を spawnSync 経由で呼ぶ。

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { filenameMap } from './lib/filename-map.mjs';

// ====================== CONFIG (書き換え対象) ======================
// EPUB spine の id (or href stem) -> docs/en/ 出力ファイル名 マッピングは
// scripts/lib/filename-map.mjs に切り出し済み (fix-internal-links.mjs / inject-anchors.mjs と共有)。
// 新規プロジェクトでは scripts/lib/filename-map.mjs と下記 CONFIG をプロジェクトに合わせて書き換える。
const CONFIG = {
  // 入力 EPUB のファイル名 (docs/ 配下に配置)
  epubFilename: 'TODO_FILL.epub',

  // 出力ディレクトリ (REPO_ROOT 起点の相対パス)
  outDir: 'docs/en',
  imgDir: 'docs/images',

  // content.opf のパス解決方法 ('auto' で META-INF/container.xml から動的解決)
  opfPath: 'auto',

  // HTML パーサ設定
  parser: {
    // h1〜h4 タグを Markdown # 〜 #### にマッピングするか
    //   true  : 標準 HTML 構造の EPUB
    //   false : <p class="chaptertitle"> ベースの古い EPUB
    supportsH1toH4: true,

    // <div class="..."> を Note 引用ブロック (> **Title**) に変換するクラス名リスト
    //   通常: ['note', 'feature']
    //   不要なら []
    noteDivClasses: ['note', 'feature'],

    // 行ごとに削除する正規表現 (ウォーターマーク・ノイズ除去)
    watermarkPatterns: [],

    // 章本体を内包する <div id="..."> (なければ null)
    //   例: 'sbo-rt-content' (O'Reilly Atlas)
    contentDivId: null,

    // 章本体を内包する <div class="..."> (なければ null)
    contentDivClass: null,
  },
};

// O'Reilly EPUB 固有の事情:
//   <div class="chapter"> 内の最初の <h1> は章タイトル、
//   <div class="sect1"> 内の <h1> はセクション見出し (Markdown ## 相当)。
//   convertToBlocks では区別できないので、renderChapter 直前に
//   「最初の chaptertitle のみ章見出し、それ以降は h1 (=##) に格下げ」する。
function demoteSubsequentChapterTitles(blocks) {
  let seen = false;
  return blocks.map(b => {
    if (b.type !== 'chaptertitle') return b;
    if (!seen) { seen = true; return b; }
    const out = { type: 'h1', text: b.text };
    if (b.anchorId) out.anchorId = b.anchorId;
    return out;
  });
}
// =================== ここから下は基本変更不要 ===================

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const EPUB_PATH = join(REPO_ROOT, 'docs', CONFIG.epubFilename);
const OUT_DIR = join(REPO_ROOT, CONFIG.outDir);
const IMG_DIR = join(REPO_ROOT, CONFIG.imgDir);

const DRY_RUN = process.argv.includes('--dry-run');
const KEEP_TMP = process.argv.includes('--keep-tmp');

const FILENAME_MAP = filenameMap;

// 現在処理中の xhtml stem ('ch04' 等)。 main loop で都度セットし、transformHref から self-ref 短縮判定に使う
let CURRENT_STEM = null;

// O'Reilly EPUB のテンプレート機構が生成する ephemeral id (`idm12345` のような suffix のないもの)。
// 本文中で参照されないので Markdown には残さない。
// 一方 `idm12345-marker` のような suffix 付きは脚注の reverse link で参照されるので保持する。
function isEphemeralId(id) {
  return /^idm\d+$/.test(id);
}

// xhtml href ("ch04.xhtml#anchor" 等) を Markdown 相対 path ("./07_chapter_4.md#anchor") に正規化
// O'Reilly EPUB に時々ある誤った prefix `Images/ch10.html` も補正する
function transformHref(href) {
  if (/^https?:\/\//i.test(href)) return href;
  if (/^mailto:/i.test(href)) return href;
  if (/^#/.test(href)) return href;
  // `Images/ch10.html#anchor` のような誤 prefix も許容 (EPUB 著者ミスの補正)
  const m = href.match(/^(?:[A-Za-z]+\/)?([a-z0-9_-]+)\.x?html(#.*)?$/i);
  if (!m) return href;
  const stem = m[1];
  const hash = m[2] || '';
  const target = filenameMap[stem];
  if (!target || target === 'SKIP') {
    console.warn(`  warn: unmapped xref href=${href}`);
    return href;
  }
  const slug = target.replace(/\.md$/, '');
  if (stem === CURRENT_STEM) return hash || `./${slug}.md`;
  return `./${slug}.md${hash}`;
}

// --- EPUB 展開 (spawnSync 経由で unzip コマンドを呼ぶ — シェル展開を経由しないので安全) ---

function extractEpub(tmpDir) {
  const r = spawnSync('unzip', ['-o', EPUB_PATH, '-d', tmpDir], { stdio: 'ignore' });
  if (r.status !== 0) {
    throw new Error(`unzip failed (status=${r.status}) for ${EPUB_PATH}`);
  }
}

// --- container.xml から OPF パスを動的解決 ---

function resolveOpfPath(tmpDir) {
  if (CONFIG.opfPath === 'auto') {
    const containerPath = join(tmpDir, 'META-INF', 'container.xml');
    if (!existsSync(containerPath)) {
      throw new Error(`META-INF/container.xml not found in ${tmpDir}`);
    }
    const containerXml = readFileSync(containerPath, 'utf-8');
    const m = containerXml.match(/<rootfile[^>]+full-path="([^"]+)"/);
    if (!m) throw new Error('container.xml: no rootfile full-path');
    const opfPath = join(tmpDir, m[1]);
    return { opfPath, oebpsDir: dirname(opfPath) };
  }
  const opfPath = join(tmpDir, CONFIG.opfPath);
  return { opfPath, oebpsDir: dirname(opfPath) };
}

// --- OPF パース (spine 順序取得) ---

function parseSpine(opfPath) {
  const xml = readFileSync(opfPath, 'utf-8');
  const manifest = new Map();
  for (const m of xml.matchAll(/<item\b([^>]+)>/g)) {
    const attrs = m[1];
    const idM = attrs.match(/\bid="([^"]+)"/);
    const hrefM = attrs.match(/\bhref="([^"]+)"/);
    if (idM && hrefM) manifest.set(idM[1], hrefM[1]);
  }
  const order = [];
  for (const m of xml.matchAll(/<itemref[^>]+idref="([^"]+)"/g)) {
    order.push(m[1]);
  }
  return { manifest, order };
}

// --- HTML ユーティリティ ---

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&hellip;/g, '…')
    .replace(/&copy;/g, '©')
    .replace(/&reg;/g, '®')
    .replace(/&trade;/g, '™')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function removeWatermark(s) {
  let result = s;
  for (const pattern of CONFIG.parser.watermarkPatterns) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'g');
    result = result.replace(re, '');
  }
  return result.replace(/\n{3,}/g, '\n\n');
}

function wrapEmphasis(text, marker) {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const before = m ? m[1] : '';
  const inner = m ? m[2] : text;
  const after = m ? m[3] : '';
  if (!inner) return '';
  const escaped = inner.split(marker).join('\\' + marker);
  return `${before}${marker}${escaped}${marker}${after}`;
}

function stripInvisibleAnchors(s) {
  // O'Reilly EPUB の indexterm anchor (self-closing) は索引マーカーで、訳文には不要。
  // noteref は脚注参照なので残し、convertInline Step 1 で `[N](#id)` 形式の Markdown リンクに変換する。
  // 以前は `\/?>` を使っていたため `?` で `/` が optional になり、noteref の opening tag (`<a ...>`)
  // も誤って一致して削除され、本文中の `<sup>1</a></sup>` から `1` だけが残る不具合があった。
  // 修正: self-closing 形式は `\/>` (必須 `/`) で厳密に限定する。
  return s
    .replace(/<a[^>]*\bdata-type="indexterm"[^>]*\/>/g, '')
    .replace(/<a[^>]*\bdata-type="indexterm"[^>]*>[\s\S]*?<\/a>/g, '');
}

function convertInline(html) {
  let s = stripInvisibleAnchors(html);

  // Step 1: <sup>...</sup> 内の <a> を脚注本文側 ref として整形
  // <sup><a href="X#Y" id="Y-marker">N</a></sup> -> <sup><a id="Y-marker"></a>[N](./X.md#Y)</sup>
  s = s.replace(/<sup>([\s\S]*?)<\/sup>/gi, (_, supInner) => {
    const aM = supInner.match(/<a([^>]*)>([\s\S]*?)<\/a>/);
    if (!aM) return `<sup>${stripTags(supInner)}</sup>`;
    const attrs = aM[1];
    const innerText = stripTags(aM[2]).trim();
    const hrefM = attrs.match(/\bhref="([^"]+)"/);
    const idM = attrs.match(/\bid="([^"]+)"/);
    const idPart = (idM && !isEphemeralId(idM[1])) ? `<a id="${idM[1]}"></a>` : '';
    if (hrefM) return `<sup>${idPart}[${innerText}](${transformHref(hrefM[1])})</sup>`;
    return `<sup>${idPart}${innerText}</sup>`;
  });

  // Step 2: 通常の <a href="..."> をリンクに変換。id 属性が併設されていれば保持
  s = s.replace(/<a([^>]*)\bhref="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g, (_, before, href, after, text) => {
    const t = stripTags(text).trim();
    if (!t) return '';
    const idM = (before + after).match(/\bid="([^"]+)"/);
    const idPart = (idM && !isEphemeralId(idM[1])) ? `<a id="${idM[1]}"></a>` : '';
    return `${idPart}[${t}](${transformHref(href)})`;
  });

  // Step 3: id 属性のみを持つ self-closing <a id="..."/> の保持
  s = s.replace(/<a([^>]*)\bid="([^"]+)"([^>]*)\/>/g, (_, b, id) => {
    return isEphemeralId(id) ? '' : `<a id="${id}"></a>`;
  });

  // Step 4: 残った <a>...</a> — id があれば保持、なければテキストだけ取り出す
  s = s.replace(/<a([^>]*)>([\s\S]*?)<\/a>/g, (_, attrs, inner) => {
    const idM = attrs.match(/\bid="([^"]+)"/);
    if (idM && !isEphemeralId(idM[1])) {
      const innerStripped = stripTags(inner).trim();
      const anchor = `<a id="${idM[1]}"></a>`;
      return innerStripped ? `${anchor}${innerStripped}` : anchor;
    }
    return inner;
  });

  s = s.replace(/<span[^>]*class="bold"[^>]*>([\s\S]*?)<\/span>/g, (_, t) => wrapEmphasis(t, '**'));
  s = s.replace(/<strong>([\s\S]*?)<\/strong>/g, (_, t) => wrapEmphasis(t, '**'));
  s = s.replace(/<b>([\s\S]*?)<\/b>/g, (_, t) => wrapEmphasis(t, '**'));
  s = s.replace(/<span[^>]*class="italic"[^>]*>([\s\S]*?)<\/span>/g, (_, t) => wrapEmphasis(t, '*'));
  s = s.replace(/<em>([\s\S]*?)<\/em>/g, (_, t) => wrapEmphasis(t, '*'));
  s = s.replace(/<i>([\s\S]*?)<\/i>/g, (_, t) => wrapEmphasis(t, '*'));
  s = s.replace(/<span[^>]*class="superscript"[^>]*>([\s\S]*?)<\/span>/g, '<sup>$1</sup>');
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/g, (_, t) => '`' + stripTags(t).replace(/`/g, '\\`') + '`');
  s = s.replace(/<br\s*\/?>/g, '\n');
  // 残った HTML タグを除去するが、脚注の視覚スタイル (<sup>) と id アンカー (<a id="X"></a>) は
  // Markdown では再現できないため例外として保持する。
  s = s.replace(/<\/?[a-z][^>]*>/gi, (tag) => {
    if (/^<\/?sup\s*>$/i.test(tag)) return tag;
    if (/^<a\s+id="[^"]+"\s*>$/i.test(tag) || /^<\/a>$/i.test(tag)) return tag;
    return '';
  });
  return decodeEntities(s).trim();
}

// --- Code block (<pre>) 変換 ---
function convertCodeBlock(preHtml) {
  const langM = preHtml.match(/data-code-language="([^"]+)"/);
  const lang = langM ? langM[1] : '';
  const innerM = preHtml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (!innerM) return '';
  let s = innerM[1];
  // O'Reilly の callout: <a class="co"><img alt="N"/></a> -> (N)
  s = s.replace(/<a[^>]*class="co"[^>]*>[\s\S]*?<img[^>]*alt="(\d+)"[^>]*\/?>[\s\S]*?<\/a>/g, '($1)');
  s = stripInvisibleAnchors(s);
  // 残ったタグはすべて除去
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  // 末尾のみ trim、内部のインデントは保持
  s = s.replace(/^\n+/, '').replace(/\s+$/, '');
  return '```' + lang + '\n' + s + '\n```';
}

// --- O'Reilly EPUB 用 Note (data-type) 変換 ---
function convertOReillyNote(divHtml, label) {
  const innerM = divHtml.match(/<div[^>]*>([\s\S]*)<\/div>/);
  if (!innerM) return '';
  let body = innerM[1];
  // sidebar の場合、先頭 <h5> をタイトルとして抽出 (label を上書き)
  // 注: <h6>Warning</h6> 等の削除より先に行わないと、h5 がそこで消費されてしまう
  let title = label;
  if (label === 'Sidebar') {
    const h5M = body.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
    if (h5M) {
      title = convertInline(h5M[1]);
      body = body.replace(/<h5[^>]*>[\s\S]*?<\/h5>/i, '');
    }
  } else {
    // それ以外は先頭の <h6>Warning</h6> 等は label と重複するので削除
    body = body.replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/i, '');
  }
  const lines = [`> **${title}**`, '> '];
  for (const m of body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = convertInline(m[1]);
    if (text) {
      for (const line of text.split('\n')) {
        lines.push('> ' + line);
      }
      lines.push('> ');
    }
  }
  while (lines[lines.length - 1] === '> ') lines.pop();
  return lines.join('\n');
}

const OREILLY_NOTE_TYPES = {
  warning: 'Warning',
  note: 'Note',
  tip: 'Tip',
  caution: 'Caution',
  important: 'Important',
  sidebar: 'Sidebar',
};

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '');
}

// --- テーブル変換 ---

function convertTable(tableHtml) {
  const rows = [];
  for (const rowM of tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    for (const cellM of rowM[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      cells.push(convertInline(cellM[1]).replace(/\|/g, '\\|').replace(/\n+/g, ' '));
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return '';

  const colCount = Math.max(...rows.map(r => r.length));
  const pad = (row) => {
    while (row.length < colCount) row.push('');
    return row.slice(0, colCount);
  };

  const lines = [
    '| ' + pad(rows[0]).join(' | ') + ' |',
    '| ' + Array(colCount).fill('---').join(' | ') + ' |',
    ...rows.slice(1).map(r => '| ' + pad(r).join(' | ') + ' |'),
  ];
  return lines.join('\n');
}

// --- Note ブロック変換 ---

function convertNote(noteHtml) {
  const titleRe = /<p[^>]*class="(?:featuretitle|exerciseshead)"[^>]*>([\s\S]*?)<\/p>/i;
  const titleM = noteHtml.match(titleRe);
  let title = titleM ? convertInline(titleM[1]) : 'Note';
  const titleWholeBoldM = title.match(/^\*\*([\s\S]+)\*\*$/);
  if (titleWholeBoldM && !titleWholeBoldM[1].includes('**')) {
    title = titleWholeBoldM[1];
  }
  const lines = [`> **${title}**`];

  const partRe = /<(p|li)[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = partRe.exec(noteHtml)) !== null) {
    const cls = m[2];
    if (/featuretitle|exerciseshead/.test(cls)) continue;
    let text = convertInline(m[3]);
    if (!text) continue;
    const wholeBoldM = text.match(/^\*\*([\s\S]+)\*\*$/);
    if (wholeBoldM && !wholeBoldM[1].includes('**')) {
      text = wholeBoldM[1];
    }
    if (/listbulleted|parabulleted/.test(cls)) {
      lines.push(`> - ${text}`);
    } else if (/listnumbered/.test(cls)) {
      lines.push(`> ${text.replace(/^\d+\.\s*/, '')}`);
    } else {
      lines.push('> ');
      lines.push(`> ${text}`);
    }
  }
  return lines.join('\n');
}

// --- 画像コピー + Markdown 参照生成 ---

function handleImage(imgTag, oebpsDir) {
  const srcM = imgTag.match(/src="([^"]+)"/);
  const altM = imgTag.match(/alt="([^"]*)"/);
  if (!srcM) return '';
  const fileName = basename(srcM[1]);
  const alt = altM ? altM[1] : fileName;
  if (!DRY_RUN) {
    const srcAbs = join(oebpsDir, srcM[1]);
    if (existsSync(srcAbs)) copyFileSync(srcAbs, join(IMG_DIR, fileName));
  }
  return `![${alt}](../images/${fileName})`;
}

// --- ネストを考慮した div 内容抽出 ---

function extractDivContent(html, className) {
  const startRe = new RegExp(`<div[^>]*\\bclass="${className}"[^>]*>`, 'i');
  return extractMatchedDivContent(html, startRe);
}

function extractDivById(html, idName) {
  const startRe = new RegExp(`<div[^>]*\\bid="${idName}"[^>]*>`, 'i');
  return extractMatchedDivContent(html, startRe);
}

function extractMatchedDivContent(html, startRe) {
  const startMatch = html.match(startRe);
  if (!startMatch) return null;

  const afterStart = html.indexOf(startMatch[0]) + startMatch[0].length;
  let depth = 1;
  let pos = afterStart;

  while (pos < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', pos);
    const nextClose = html.indexOf('</div>', pos);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) return html.slice(afterStart, nextClose);
      pos = nextClose + 6;
    }
  }
  return html.slice(afterStart);
}

// body 内の `<div ... attrPattern ...>...</div>` を depth-aware に全件抽出し、
// placeholder `<!--PREFIX_N-->` で置換する。store には抽出された full HTML が順番に push される。
// 内部に <div> がネストしていても、対応する </div> を depth で正しく追跡する。
function preExtractDivByAttr(body, attrPattern, placeholderPrefix, store) {
  const startRe = new RegExp(`<div[^>]*\\b${attrPattern}[^>]*>`, 'g');
  const matches = [...body.matchAll(startRe)];
  let result = '';
  let lastEnd = 0;
  for (const m of matches) {
    const startIdx = m.index;
    if (startIdx < lastEnd) continue;       // 既に処理済み (前 placeholder の内側にあった)
    const tagEnd = startIdx + m[0].length;
    let depth = 1;
    let pos = tagEnd;
    let endPos = -1;
    while (pos < body.length && depth > 0) {
      const nextOpen = body.indexOf('<div', pos);
      const nextClose = body.indexOf('</div>', pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) { endPos = nextClose + 6; break; }
        pos = nextClose + 6;
      }
    }
    if (endPos === -1) continue;
    const full = body.slice(startIdx, endPos);
    const idx = store.length;
    store.push(full);
    result += body.slice(lastEnd, startIdx) + `<!--${placeholderPrefix}_${idx}-->`;
    lastEnd = endPos;
  }
  result += body.slice(lastEnd);
  return result;
}

// --- XHTML -> ブロック配列 ---

function convertToBlocks(xhtml, oebpsDir, tableStore = null, exampleStore = null, sidebarStore = null, noteStore = null) {
  const blocks = [];
  const bodyM = xhtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyM) return blocks;
  let body = bodyM[1];

  if (CONFIG.parser.contentDivId) {
    const idContent = extractDivById(body, CONFIG.parser.contentDivId);
    if (idContent !== null) body = idContent;
  }
  if (CONFIG.parser.contentDivClass) {
    const classContent = extractDivContent(body, CONFIG.parser.contentDivClass);
    if (classContent !== null) body = classContent;
  }

  // <table> を placeholder 化: <table>...<td><div>...</div></td>...</table> の内部 </div> が
  // 外側 <div class="chapter"> の non-greedy ([\s\S]*?</div>) を早く閉じる問題を回避する。
  // トップレベル呼び出しで table を抽出して placeholder で置換、再帰呼び出しでは tableStore を継承。
  const tables = tableStore || [];
  if (!tableStore) {
    body = body.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (full) => {
      const idx = tables.length;
      tables.push(full);
      return `<!--TBL_${idx}-->`;
    });
  }

  // <div data-type="example"> も placeholder 化: <aside><div class="sidebar"><div data-type="example">
  // のような3階層ネストで、内側 example div の </div> が外側 sidebar div を早く閉じる問題を回避。
  // depth-aware で正しく対応 </div> まで取得する。
  const examples = exampleStore || [];
  if (!exampleStore) {
    body = preExtractDivByAttr(body, 'data-type="example"', 'EX', examples);
  }

  // <aside data-type="sidebar">...</aside> を placeholder 化: 外側 <div class="chapter"> の non-greedy が
  // sidebar 内 <div class="sidebar"> の </div> で早く閉じる問題を回避する。
  // <aside> は内部に <aside> をネストしないので、non-greedy で最初の </aside> までで OK。
  const sidebars = sidebarStore || [];
  if (!sidebarStore) {
    body = body.replace(/<aside\b[^>]*\bdata-type="sidebar"[^>]*>[\s\S]*?<\/aside>/gi, (full) => {
      const idx = sidebars.length;
      sidebars.push(full);
      return `<!--SB_${idx}-->`;
    });
  }

  // <div data-type="(warning|note|tip|caution|important)"> も placeholder 化:
  // O'Reilly note 系の div も外側 div の non-greedy 早期 close を引き起こすことがあるため、
  // depth-aware で取り出して別経路 (note placeholder) で処理する。
  const notes = noteStore || [];
  if (!noteStore) {
    body = preExtractDivByAttr(body, 'data-type="(?:warning|note|tip|caution|important)"', 'NT', notes);
  }

  let pendingTableCaption = '';
  // h6 を top-level に含める理由:
  // O'Reilly EPUB は <figure><div class="figure">...<h6>Figure N. ...</h6></div></figure>
  // で figure caption を入れるが、章先頭の figure は外側 <div class="chapter"> 内に
  // ネストされるため、non-greedy 正規表現が誤マッチして親 div 解析が失敗する。
  // 結果として img だけは <img> alternation で拾えるが h6 が落ちる。
  // h6 を top-level で拾い、<span class="label"> 付きのものだけを figurecaption として扱う。
  //
  // tag 列挙順は longest-first が必須: 'p' が 'pre' より先にあると、<pre data-type="...">
  // が <p (tag) + re data-type="..." (attrs)> として誤マッチし、</p> までを非貪欲に
  // 飲み込んで後続の figure 等を消失させる。pre を p より前に置く。
  // figure を tagAlt に含める (nested div 回避)。table / example / sidebar / note は placeholder 化したので除外。
  const tagAlt = CONFIG.parser.supportsH1toH4
    ? '(pre|p|div|figure|ul|ol|h1|h2|h3|h4|h6)'
    : '(pre|p|div|figure|ul|ol|h6)';
  const re = new RegExp(`<${tagAlt}([^>]*)>([\\s\\S]*?)</\\1>|<img([^>]*)/?>(?:</img>)?|<!--TBL_(\\d+)-->|<!--EX_(\\d+)-->|<!--SB_(\\d+)-->|<!--NT_(\\d+)-->`, 'gi');
  for (const m of body.matchAll(re)) {
    // table placeholder の処理 (m[5] は <!--TBL_N--> の N)
    if (m[5] !== undefined) {
      const tableHtml = tables[parseInt(m[5])];
      const tIdM = tableHtml.match(/<table[^>]*\bid="([^"]+)"/);
      if (tIdM && !isEphemeralId(tIdM[1])) {
        blocks.push({ type: 'anchor', text: `<a id="${tIdM[1]}"></a>` });
      }
      const captionM = tableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
      if (captionM) {
        blocks.push({ type: 'tablecaption', text: convertInline(captionM[1]) });
      }
      if (pendingTableCaption) {
        blocks.push({ type: 'tablecaption', text: pendingTableCaption });
        pendingTableCaption = '';
      }
      const md = convertTable(tableHtml);
      if (md) blocks.push({ type: 'table', text: md });
      continue;
    }

    // example placeholder の処理 (m[6] は <!--EX_N--> の N)
    // <div data-type="example" id="..."> はコード例題ブロック。id を保持し、内部の <pre>/<p> を再帰処理。
    if (m[6] !== undefined) {
      const exHtml = examples[parseInt(m[6])];
      const exIdM = exHtml.match(/<div[^>]*\bid="([^"]+)"/);
      if (exIdM && !isEphemeralId(exIdM[1])) {
        blocks.push({ type: 'anchor', text: `<a id="${exIdM[1]}"></a>` });
      }
      // 例題の中身 (<p class="figurecaption"> や <pre> 等) を取り出して再帰処理
      const innerM = exHtml.match(/^<div[^>]*>([\s\S]*)<\/div>$/);
      if (innerM) {
        const sub = convertToBlocks(`<body>${innerM[1]}</body>`, oebpsDir, tables, examples, sidebars, notes);
        blocks.push(...sub);
      }
      continue;
    }

    // sidebar placeholder の処理 (m[7] は <!--SB_N--> の N)
    // <aside data-type="sidebar"><div class="sidebar" id="X"><h5>Title</h5>...</div></aside>
    // → <a id="X"></a> + > **Title** ブロック (note 形式)
    if (m[7] !== undefined) {
      const sidebarHtml = sidebars[parseInt(m[7])];
      const innerDivM = sidebarHtml.match(/<div[^>]*\bclass="sidebar"[^>]*>([\s\S]*?)<\/div>\s*<\/aside>/i)
        || sidebarHtml.match(/<div[^>]*>([\s\S]*?)<\/div>\s*<\/aside>/i);
      if (innerDivM) {
        const sidebarTagM = sidebarHtml.match(/<div[^>]*\bclass="sidebar"[^>]*>/i);
        const idAttrM = sidebarTagM ? sidebarTagM[0].match(/\bid="([^"]+)"/) : null;
        if (idAttrM && !isEphemeralId(idAttrM[1])) {
          blocks.push({ type: 'anchor', text: `<a id="${idAttrM[1]}"></a>` });
        }
        const sidebarInner = innerDivM[1];
        // sidebar 内の <div data-type="example"> も既に placeholder 化されているはずだが、
        // 念のため convertOReillyNote には placeholder を含む可能性のある HTML を渡す。
        // convertOReillyNote 内では <p> しか扱わないので問題なし。
        blocks.push({ type: 'note', text: convertOReillyNote(`<div class="sidebar">${sidebarInner}</div>`, 'Sidebar') });
        // example placeholder が sidebar 内にあれば、note の後に展開
        for (const phM of sidebarInner.matchAll(/<!--EX_(\d+)-->/g)) {
          const exHtml = examples[parseInt(phM[1])];
          const exIdM = exHtml.match(/<div[^>]*\bid="([^"]+)"/);
          if (exIdM && !isEphemeralId(exIdM[1])) {
            blocks.push({ type: 'anchor', text: `<a id="${exIdM[1]}"></a>` });
          }
          const exInnerM = exHtml.match(/^<div[^>]*>([\s\S]*)<\/div>$/);
          if (exInnerM) {
            const sub = convertToBlocks(`<body>${exInnerM[1]}</body>`, oebpsDir, tables, examples, sidebars, notes);
            blocks.push(...sub);
          }
        }
      }
      continue;
    }

    // note placeholder の処理 (m[8] は <!--NT_N--> の N)
    // <div data-type="warning|note|tip|caution|important" id?="..."> → <a id="X"></a> + > **Label** ブロック
    if (m[8] !== undefined) {
      const noteHtml = notes[parseInt(m[8])];
      const dataTypeM = noteHtml.match(/<div[^>]*\bdata-type="([^"]+)"/);
      const dataType = dataTypeM ? dataTypeM[1] : '';
      const idM = noteHtml.match(/<div[^>]*\bid="([^"]+)"/);
      if (idM && !isEphemeralId(idM[1])) {
        blocks.push({ type: 'anchor', text: `<a id="${idM[1]}"></a>` });
      }
      const label = OREILLY_NOTE_TYPES[dataType] || OREILLY_NOTE_TYPES.note || 'Note';
      blocks.push({ type: 'note', text: convertOReillyNote(noteHtml, label) });
      continue;
    }

    const tag = m[1] || 'img';
    const attrs = m[2] || m[4] || '';
    const inner = m[3] || '';
    const full = m[0];
    const clsM = attrs.match(/class="([^"]*)"/);
    const cls = clsM ? clsM[1] : '';

    switch (tag) {
      case 'h1': {
        blocks.push({ type: 'chaptertitle', text: convertInline(inner) });
        break;
      }
      case 'h2': {
        blocks.push({ type: 'h1', text: convertInline(inner) });
        break;
      }
      case 'h3': {
        blocks.push({ type: 'h2', text: convertInline(inner) });
        break;
      }
      case 'h4': {
        blocks.push({ type: 'h3', text: convertInline(inner) });
        break;
      }
      case 'h6': {
        // O'Reilly EPUB の figure caption は <h6><span class="label">Figure N. </span>...</h6>。
        // span class="label" が付いている h6 のみを figurecaption として拾う。
        // (Note/Tip/Warning ラベルの h6 は note 系 div 内で別ルートで処理される)
        if (/\bclass="label"/.test(inner)) {
          blocks.push({ type: 'figurecaption', text: convertInline(inner) });
        }
        break;
      }
      case 'p': {
        if (cls === 'chaptertitle') {
          const raw = convertInline(inner);
          const parts = raw.split('\n').map(s => s.trim()).filter(Boolean);
          let text;
          if (parts.length >= 3 && /^[\dA-Z]{1,3}$/.test(parts[1])) {
            const word = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
            text = `${word} ${parts[1]}: ${parts.slice(2).join(' ')}`;
          } else if (parts.length === 2) {
            text = parts.join(': ');
          } else {
            text = parts.join(' ');
          }
          blocks.push({ type: 'chaptertitle', text });
        } else if (cls === 'h1') {
          blocks.push({ type: 'h1', text: convertInline(inner) });
        } else if (cls === 'h2') {
          blocks.push({ type: 'h2', text: convertInline(inner) });
        } else if (cls === 'h3' || cls === 'h4' || cls === 'h5') {
          blocks.push({ type: 'h3', text: convertInline(inner) });
        } else if (cls === 'figurecaption' || cls === 'figurelabel' || cls === 'caption') {
          blocks.push({ type: 'figurecaption', text: convertInline(inner) });
        } else if (cls === 'imgepub') {
          for (const imgM of full.matchAll(/<img([^>]*)\/?>(?:<\/img>)?/gi)) {
            const imgText = handleImage(imgM[0], oebpsDir);
            if (imgText) blocks.push({ type: 'img', text: imgText });
          }
        } else if (inner.includes('<img')) {
          for (const imgM of inner.matchAll(/<img([^>]*)\/?>(?:<\/img>)?/gi)) {
            const imgText = handleImage(imgM[0], oebpsDir);
            if (imgText) blocks.push({ type: 'img', text: imgText });
          }
        } else if (cls === 'tablecaption') {
          const cap = convertInline(inner);
          blocks.push({ type: 'tablecaption', text: cap });
          pendingTableCaption = '';
        } else if (cls === 'listnumbered') {
          const txt = convertInline(inner).replace(/^\d+\.\s*/, '');
          blocks.push({ type: 'numbered', text: txt });
        } else if (cls === 'listbulleted' || cls === 'parabulleted') {
          blocks.push({ type: 'bullet', text: convertInline(inner) });
        } else {
          // <p id="X"> (例: 脚注本文 <p data-type="footnote" id="idmXXX">) は
          // anchor block を先に push してジャンプ先を作る。
          // 脚注本文は `idm<digits>` (suffix なし) を id にとるため通常は ephemeral 扱いとなるが、
          // data-type="footnote" の場合は本文中の noteref から参照されるので保持する。
          const pIdM = attrs.match(/\bid="([^"]+)"/);
          const isFootnote = /\bdata-type="footnote"/.test(attrs);
          if (pIdM && (isFootnote || !isEphemeralId(pIdM[1]))) {
            blocks.push({ type: 'anchor', text: `<a id="${pIdM[1]}"></a>` });
          }
          const text = convertInline(inner);
          if (text) blocks.push({ type: 'p', text });
        }
        break;
      }
      case 'div': {
        const dataTypeM = attrs.match(/\bdata-type="([^"]+)"/);
        const dataType = dataTypeM ? dataTypeM[1] : '';
        if (OREILLY_NOTE_TYPES[dataType] || cls === 'sidebar') {
          const label = OREILLY_NOTE_TYPES[dataType] || OREILLY_NOTE_TYPES.sidebar;
          blocks.push({ type: 'note', text: convertOReillyNote(full, label) });
          for (const imgM of full.matchAll(/<img([^>]*)\/?>(?:<\/img>)?/gi)) {
            const imgText = handleImage(imgM[0], oebpsDir);
            if (imgText) blocks.push({ type: 'img', text: imgText });
          }
        } else if (CONFIG.parser.noteDivClasses.includes(cls)) {
          blocks.push({ type: 'note', text: convertNote(full) });
          for (const imgM of full.matchAll(/<img([^>]*)\/?>(?:<\/img>)?/gi)) {
            const imgText = handleImage(imgM[0], oebpsDir);
            if (imgText) blocks.push({ type: 'img', text: imgText });
          }
        } else if (cls === 'figure' || cls === 'graphic') {
          // figure id 抽出: 外側 div / 内側 div / figure tag のいずれかから
          const outerIdM = attrs.match(/\bid="([^"]+)"/);
          const innerIdM = inner.match(/<div\s+(?:[^>]*\s+)?id="([^"]+)"[^>]*\bclass="figure"/);
          const figId = (innerIdM && innerIdM[1]) || (outerIdM && outerIdM[1]);
          if (figId && !isEphemeralId(figId)) {
            blocks.push({ type: 'anchor', text: `<a id="${figId}"></a>` });
          }
          for (const imgM of full.matchAll(/<img([^>]*)\/?>(?:<\/img>)?/gi)) {
            const imgText = handleImage(imgM[0], oebpsDir);
            if (imgText) blocks.push({ type: 'img', text: imgText });
          }
          for (const fcM of full.matchAll(/<p[^>]*class="(?:figurecaption|figurelabel)"[^>]*>([\s\S]*?)<\/p>/gi)) {
            blocks.push({ type: 'figurecaption', text: convertInline(fcM[1]) });
          }
          // O'Reilly EPUB は <h6><span class="label">Figure N-N. </span>...</h6> 形式で
          // figure caption を入れることが多い。<p class="figurecaption"> と同等に拾う。
          for (const h6M of full.matchAll(/<h6[^>]*>([\s\S]*?)<\/h6>/gi)) {
            blocks.push({ type: 'figurecaption', text: convertInline(h6M[1]) });
          }
        } else {
          // 一般 div: id があれば子 block の最初の見出しに anchorId として貼る (section の id 保持)
          const idM = attrs.match(/\bid="([^"]+)"/);
          const sub = convertToBlocks(`<body>${inner}</body>`, oebpsDir, tables, examples, sidebars, notes);
          if (idM && !isEphemeralId(idM[1]) && sub.length) {
            const head = sub.find(b => /^(chaptertitle|h1|h2|h3)$/.test(b.type));
            if (head && !head.anchorId) head.anchorId = idM[1];
          }
          blocks.push(...sub);
        }
        break;
      }
      case 'table': {
        // <table id="..."> を保持
        const tIdM = attrs.match(/\bid="([^"]+)"/);
        if (tIdM && !isEphemeralId(tIdM[1])) {
          blocks.push({ type: 'anchor', text: `<a id="${tIdM[1]}"></a>` });
        }
        // <caption>...</caption> をテーブルキャプションとして復元
        const captionM = full.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
        if (captionM) {
          blocks.push({ type: 'tablecaption', text: convertInline(captionM[1]) });
        }
        if (pendingTableCaption) {
          blocks.push({ type: 'tablecaption', text: pendingTableCaption });
          pendingTableCaption = '';
        }
        const md = convertTable(full);
        if (md) blocks.push({ type: 'table', text: md });
        break;
      }
      case 'ul': {
        const items = [...full.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
          .map(lm => `- ${convertInline(lm[1])}`);
        if (items.length) blocks.push({ type: 'list', text: items.join('\n') });
        break;
      }
      case 'ol': {
        // O'Reilly EPUB の <ol class="calloutlist"> はコード内 callout (1)(2) の解説リスト。
        // 各 <li> の先頭に <a id="callout_chap_NN_COX-Y"></a> がある。これを保持する。
        const isCalloutList = /\bclass="(?:[^"]*\b)?(?:calloutlist|callout)\b/.test(attrs);
        const items = [...full.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((lm, i) => {
          let liInner = lm[1];
          // li 内の id 持ち <a> を保持 (calloutlist では先頭にある)
          let idAnchor = '';
          if (isCalloutList) {
            const idM = liInner.match(/<a[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<\/a>/);
            if (idM && !isEphemeralId(idM[1])) {
              idAnchor = `<a id="${idM[1]}"></a>`;
              // calloutlist の <a id>...</a> は元々 [1] のような表示を持つが、Markdown の "1. " と
              // 重複するため、内容は捨てて id だけ保持する
              liInner = liInner.replace(/<a[^>]*>[\s\S]*?<\/a>/, '');
            }
          }
          return `${i + 1}. ${idAnchor}${convertInline(liInner)}`.trim();
        });
        if (items.length) blocks.push({ type: 'list', text: items.join('\n') });
        break;
      }
      case 'pre': {
        const code = convertCodeBlock(full);
        if (code) blocks.push({ type: 'code', text: code });
        break;
      }
      case 'figure': {
        // O'Reilly EPUB は <figure ...><div id="..." class="figure"><img/><h6>caption</h6></div></figure> 構造。
        // figure の id は外側 figure tag か内側 div のどちらにあってもよい。
        const innerDivIdM = inner.match(/<div\s+(?:[^>]*\s+)?id="([^"]+)"[^>]*\bclass="figure"/);
        const outerIdM = attrs.match(/\bid="([^"]+)"/);
        const figId = (innerDivIdM && innerDivIdM[1]) || (outerIdM && outerIdM[1]);
        if (figId && !isEphemeralId(figId)) {
          blocks.push({ type: 'anchor', text: `<a id="${figId}"></a>` });
        }
        for (const imgM of full.matchAll(/<img([^>]*)\/?>(?:<\/img>)?/gi)) {
          const imgText = handleImage(imgM[0], oebpsDir);
          if (imgText) blocks.push({ type: 'img', text: imgText });
        }
        for (const fcM of full.matchAll(/<p[^>]*class="(?:figurecaption|figurelabel)"[^>]*>([\s\S]*?)<\/p>/gi)) {
          blocks.push({ type: 'figurecaption', text: convertInline(fcM[1]) });
        }
        for (const h6M of full.matchAll(/<h6[^>]*>([\s\S]*?)<\/h6>/gi)) {
          blocks.push({ type: 'figurecaption', text: convertInline(h6M[1]) });
        }
        break;
      }
      case 'img': {
        blocks.push({ type: 'img', text: handleImage(full, oebpsDir) });
        break;
      }
    }
  }
  return blocks;
}

// --- ブロック配列 -> Markdown テキスト ---

function renderChapter(blocks) {
  const merged = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'chaptertitle') {
      const next = blocks[i + 1];
      if (next?.type === 'chaptertitle') {
        const m = { type: 'chapter_h', text: `${b.text}: ${next.text}` };
        const anchorId = b.anchorId || next.anchorId;
        if (anchorId) m.anchorId = anchorId;
        merged.push(m);
        i++;
      } else {
        const m = { type: 'chapter_h', text: b.text };
        if (b.anchorId) m.anchorId = b.anchorId;
        merged.push(m);
      }
    } else {
      merged.push(b);
    }
  }

  const coalesced = [];
  for (let i = 0; i < merged.length; i++) {
    const b = merged[i];
    if (b.type === 'numbered') {
      const items = [b.text];
      while (merged[i + 1]?.type === 'numbered') items.push(merged[++i].text);
      coalesced.push({ type: 'list', text: items.map((t, j) => `${j + 1}. ${t}`).join('\n') });
    } else if (b.type === 'bullet') {
      const items = [b.text];
      while (merged[i + 1]?.type === 'bullet') items.push(merged[++i].text);
      coalesced.push({ type: 'list', text: items.map(t => `- ${t}`).join('\n') });
    } else {
      coalesced.push(b);
    }
  }

  const lines = [];
  let prev = '';
  for (const b of coalesced) {
    if (prev && prev !== 'chapter_h') lines.push('');
    const idSuffix = b.anchorId ? ` {#${b.anchorId}}` : '';
    switch (b.type) {
      case 'chapter_h':   lines.push(`# ${b.text}${idSuffix}`); break;
      case 'h1':          lines.push(`## ${b.text}${idSuffix}`); break;
      case 'h2':          lines.push(`### ${b.text}${idSuffix}`); break;
      case 'h3':          lines.push(`#### ${b.text}${idSuffix}`); break;
      case 'p':           lines.push(b.text); break;
      case 'figurecaption':
      case 'tablecaption': {
        const cleaned = b.text.replace(/\*\*([^*]+)\*\*/g, '$1');
        lines.push(`*${cleaned}*`);
        break;
      }
      case 'anchor':      lines.push(b.text); break;
      case 'img':
      case 'table':
      case 'list':
      case 'code':
      case 'note':        lines.push(b.text); break;
    }
    prev = b.type;
  }

  return removeWatermark(lines.join('\n')) + '\n';
}

function deriveKey(href) {
  return href.replace(/\.x?html$/, '').replace(/^.*\//, '');
}

// --- メイン ---

async function main() {
  if (CONFIG.epubFilename === 'TODO_FILL.epub' || Object.keys(filenameMap).length === 0) {
    console.error('Error: CONFIG is not filled in. Edit scripts/extract-epub.mjs CONFIG block and scripts/lib/filename-map.mjs first.');
    console.error('See: book-translation-pipeline skill の references/extract-epub-customization.md');
    process.exit(1);
  }

  if (!existsSync(EPUB_PATH)) {
    console.error(`Error: EPUB not found: ${EPUB_PATH}`);
    process.exit(1);
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'epub-extract-'));

  try {
    console.log('Extracting EPUB...');
    extractEpub(tmpDir);

    const { opfPath, oebpsDir } = resolveOpfPath(tmpDir);
    if (!existsSync(opfPath)) {
      console.error(`Error: content.opf not found: ${opfPath}`);
      process.exit(1);
    }

    const { manifest, order } = parseSpine(opfPath);

    if (!DRY_RUN) {
      mkdirSync(OUT_DIR, { recursive: true });
      mkdirSync(IMG_DIR, { recursive: true });
    }

    const fileContents = new Map();
    let processed = 0;
    let skipped = 0;

    for (const idref of order) {
      const href = manifest.get(idref);
      if (!href || !/\.x?html$/.test(href)) continue;

      const key = deriveKey(href);
      const outFile = FILENAME_MAP[key];

      if (outFile === undefined) { skipped++; console.log(`  skip (unmapped): ${key}`); continue; }
      if (outFile === 'SKIP')    { skipped++; continue; }

      const xhtmlPath = join(oebpsDir, href);
      if (!existsSync(xhtmlPath)) {
        console.warn(`  warn: not found: ${href}`);
        continue;
      }

      const xhtml = readFileSync(xhtmlPath, 'utf-8');
      CURRENT_STEM = key;
      const blocks = demoteSubsequentChapterTitles(convertToBlocks(xhtml, oebpsDir));
      const md = renderChapter(blocks);
      CURRENT_STEM = null;

      const target = outFile ?? 'index.md';
      if (fileContents.has(target)) {
        fileContents.set(target, fileContents.get(target) + '\n---\n\n' + md);
      } else {
        fileContents.set(target, md);
      }
      processed++;
    }

    for (const [fileName, content] of fileContents) {
      const outPath = join(OUT_DIR, fileName);
      const kb = (content.length / 1024).toFixed(1);
      // index.md は cover 由来でユーザがTOC等を手作業で追記している場合がある。
      // 既存ファイルが新規生成より大きい (= 拡張済み) なら上書きしない。
      // 強制上書きしたい場合は --force-index フラグを指定。
      const forceIndex = process.argv.includes('--force-index');
      if (fileName === 'index.md' && !forceIndex && existsSync(outPath)) {
        const existing = readFileSync(outPath, 'utf-8');
        if (existing.length > content.length * 1.5) {
          console.log(`  skip:  ${CONFIG.outDir}/${fileName}  (existing ${(existing.length/1024).toFixed(1)} KB > new ${kb} KB, customized; use --force-index to override)`);
          continue;
        }
      }
      if (DRY_RUN) {
        console.log(`[DRY] ${CONFIG.outDir}/${fileName}  (${kb} KB)`);
      } else {
        writeFileSync(outPath, content, 'utf-8');
        console.log(`  wrote: ${CONFIG.outDir}/${fileName}  (${kb} KB)`);
      }
    }

    const imgSrc = join(oebpsDir, 'images');
    if (existsSync(imgSrc)) {
      const imgs = readdirSync(imgSrc);
      if (DRY_RUN) {
        console.log(`[DRY] ${CONFIG.imgDir}/  (${imgs.length} images)`);
      } else {
        let copied = 0;
        for (const img of imgs) {
          const dest = join(IMG_DIR, img);
          if (!existsSync(dest)) { copyFileSync(join(imgSrc, img), dest); copied++; }
        }
        console.log(`  images: ${imgs.length} total, ${copied} newly copied`);
      }
    }

    console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Done: ${processed} files, ${skipped} skipped.`);
  } finally {
    if (!KEEP_TMP) rmSync(tmpDir, { recursive: true, force: true });
    else console.log(`Kept tmp: ${tmpDir}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
