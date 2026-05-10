#!/usr/bin/env node
// docs/ja 内の Markdown link href を `xxx.xhtml(#yyy)?` 形式から
// `./<NN_slug>.md(#yyy)?` 形式に変換する後処理スクリプト。
//
// docs/en は extract-epub.mjs が transformHref で正規化済みなので、デフォルトでは ja のみが対象。
// `--en-also` で en も追加対象にできる (再校正後に extract を再生成しない場合の保険)。
//
// 使い方:
//   node scripts/fix-internal-links.mjs            # docs/ja に適用
//   node scripts/fix-internal-links.mjs --dry-run  # 件数のみ
//   node scripts/fix-internal-links.mjs --en-also  # docs/en も対象に

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filenameMap } from './lib/filename-map.mjs';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_DIRS = process.argv.includes('--en-also') ? ['docs/en', 'docs/ja'] : ['docs/ja'];

// xhtml stem -> md slug マップを SSOT (lib/filename-map.mjs) から構築
const xhtmlToSlug = new Map();
for (const [stem, mdFile] of Object.entries(filenameMap)) {
  if (!mdFile || mdFile === 'SKIP') continue;
  xhtmlToSlug.set(stem, mdFile.replace(/\.md$/, ''));
}

// Markdown link href 文脈に限定 (` ](xxx.xhtml...)` の形)。本文中の単独 xhtml 文字列は触らない。
// EPUB 著者ミスの `Images/ch10.html` のような誤 prefix も補正対象に含める。
const linkRe = /\]\((?:[A-Za-z][A-Za-z0-9_-]*\/)?([a-z0-9_-]+)\.x?html(#[^)]*)?\)/gi;

let totalFiles = 0;
let totalRepl = 0;
const unmapped = new Set();

for (const dir of TARGET_DIRS) {
  const dirAbs = join(REPO_ROOT, dir);
  if (!existsSync(dirAbs)) continue;
  for (const f of readdirSync(dirAbs)) {
    if (!f.endsWith('.md')) continue;
    const path = join(dirAbs, f);
    const before = readFileSync(path, 'utf-8');
    const currentSlug = f.replace(/\.md$/, '');
    let count = 0;
    const after = before.replace(linkRe, (match, stem, hash = '') => {
      const slug = xhtmlToSlug.get(stem);
      if (!slug) {
        unmapped.add(stem);
        return match;
      }
      count++;
      // 同一ファイル内 self-ref → hash のみに短縮 (スクロールが綺麗)
      if (slug === currentSlug) return hash ? `](${hash})` : `](./${slug}.md)`;
      return `](./${slug}.md${hash})`;
    });
    if (count > 0) {
      totalRepl += count;
      totalFiles++;
      if (!DRY_RUN) writeFileSync(path, after, 'utf-8');
      console.log(`  ${DRY_RUN ? '[DRY] ' : ''}${dir}/${f}: ${count} link(s)`);
    }
  }
}

console.log(`\n${DRY_RUN ? '[DRY] ' : ''}Total: ${totalRepl} replacements across ${totalFiles} files`);
if (unmapped.size) {
  console.error('\n⚠  Unmapped xhtml stems (kept as-is):');
  for (const s of unmapped) console.error(`   - ${s}.xhtml`);
  process.exit(1);
}
