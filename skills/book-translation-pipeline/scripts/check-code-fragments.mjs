#!/usr/bin/env node
// 抽出/翻訳結果の Markdown ファイルから「断片化バッククォート」を検出する lint。
//
// 検出対象:
//   1. 隣接バッククォート (空白なし):    `x``y`   ← ほぼ確実にバグ
//      EPUB の <code>x</code><code>y</code> や、 ```python ``` の破壊形跡
//   2. 多数連続バッククォート (空白あり):  `a` `b` `c` `d` (4 つ以上)
//      EPUB の <pre><code>a</code> <code>b</code>...</pre> 断片化や、
//      翻訳エージェントが ```python ``` を inline code 連続に分解した結果
//
// 使い方:
//   node scripts/check-code-fragments.mjs docs/en/07_chapter_4.md
//   node scripts/check-code-fragments.mjs docs/en/*.md docs/ja/*.md
//
// exit 0: 問題なし
// exit 1: 断片化を検出 (詳細を stdout に出力)

import { readFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/check-code-fragments.mjs <file.md> [<file2.md> ...]');
  process.exit(2);
}

// `` `x``y` `` パターン: 閉じバッククォート直後に開きバッククォートが続く (空白ゼロ)
const ADJACENT_NO_SPACE = /`[^`\n]+``[^`\n]+`/;
// 連続 inline-code から識別子分割を検出するヘルパ
const INLINE_SPAN = /`[^`\n]+`/g;
const SYMBOL_ONLY_SPAN = /^`[^a-zA-Z0-9_\s`]+`$/;
// `` `def` `allocate` `(` `line` `:` `` のような:
//   3 つ以上の inline code が空白 1 個区切りで連続し、かつ
//   そのうち少なくとも 1 つが記号単独 ((  :  ,  ->  等) の場合のみ異常と判定。
// styleguide の「`> **Note**` `> **Warning**` ...」のような英字ラベル列挙は誤検知しない。
function isSymbolFragmented(line) {
  const adj = line.match(/(?:`[^`\n]+`\s){2,}`[^`\n]+`/);
  if (!adj) return false;
  const spans = adj[0].match(INLINE_SPAN) || [];
  return spans.some(s => SYMBOL_ONLY_SPAN.test(s));
}

// `` ```...``` `` フェンス内は除外する (本来のコードブロックを誤検知しない)
function stripFences(text) {
  const lines = text.split('\n');
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    out.push(inFence ? '' : line);
  }
  return out;
}

let totalFindings = 0;
for (const arg of args) {
  const path = resolve(arg);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    console.error(`read failed: ${path}: ${e.message}`);
    process.exit(2);
  }
  const lines = stripFences(text);
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ADJACENT_NO_SPACE.test(line)) {
      findings.push({ line: i + 1, kind: 'adjacent-no-space', preview: line.slice(0, 120) });
    } else if (isSymbolFragmented(line)) {
      findings.push({ line: i + 1, kind: 'symbol-fragmented', preview: line.slice(0, 120) });
    }
  }
  if (findings.length) {
    console.log(`${arg}: ${findings.length} fragment(s)`);
    for (const f of findings) {
      console.log(`  L${f.line} [${f.kind}] ${f.preview}`);
    }
    totalFindings += findings.length;
  }
}

if (totalFindings > 0) {
  console.log(`\nTotal: ${totalFindings} fragmented backtick pattern(s).`);
  console.log('Likely causes:');
  console.log('  - adjacent-no-space: EPUB <code>x</code><code>y</code> abutting');
  console.log('  - symbol-fragmented: ```lang fence broken into inline-code run (symbols like `(` `:` mixed)');
  console.log('Fix in extract-epub.mjs (convertOReillyNote / convertInline) or translation agent.');
  process.exit(1);
}
process.exit(0);
