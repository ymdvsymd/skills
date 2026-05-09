#!/usr/bin/env node
// docs/en と docs/ja の全 .md ファイルを走査し、内部リンクの anchor が
// リンク先 md ファイルで定義されているか確認する。死リンクを検出してレポート。
//
// id 定義として認識するもの:
//   - <a id="X"></a>   (HTML フォールバック)
//   - {#X}             (VitePress 標準カスタムアンカー)
//   - 見出し行の自動 slug (markdown-it-anchor のデフォルト規則の簡易再現)
//
// 検証対象:
//   - 同一ファイル内 anchor: [...](#X)
//   - 別ファイル内 anchor: [...](./X.md#Y) または [...](X.md#Y)
//
// ホワイトリスト (既知 / スコープ外):
//   - idmNNN (suffix なし): O'Reilly EPUB の ephemeral id、参照されない
//   - 外部 URL (http/https/mailto)
//
// 使い方:
//   node scripts/check-links.mjs
//   node scripts/check-links.mjs --verbose   # 全リンクを表示
//
// 終了コード:
//   0 = errors なし
//   1 = errors あり

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const VERBOSE = process.argv.includes('--verbose');

// 見出しテキスト → markdown-it-anchor のデフォルト slug (簡易版)
//   - 小文字化
//   - 空白 → '-'
//   - 英数字・ハイフン・日本語以外を除去
//   - 連続ハイフンを1つに
function slugify(text) {
  let s = text.toLowerCase();
  s = s.replace(/<[^>]+>/g, '');                  // HTML タグ除去
  s = s.replace(/`/g, '');                        // インラインコード backtick 除去
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, '$1');     // bold
  s = s.replace(/\*([\s\S]+?)\*/g, '$1');         // italic
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');     // 画像参照
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');  // リンク → text のみ
  s = s.replace(/[^\w\s぀-ゟ゠-ヿ一-鿿ー　-〿-]/g, '');
  s = s.replace(/\s+/g, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s;
}

function isWhitelistedAnchor(anchor) {
  if (/^idm\d+$/.test(anchor)) return true;       // ephemeral id
  return false;
}

// コードブロック (```...```) 内の `# コメント` を見出しと誤検知しないために、
// コードブロック範囲を改行のみに置換した sanitized 版を返す。
function stripCodeBlocks(content) {
  return content.replace(/^```[\s\S]*?^```$/gm, (block) => {
    const lineCount = block.split('\n').length;
    return '\n'.repeat(lineCount - 1);
  });
}

// 全 md ファイルから id 定義を集める
function collectAnchors(content) {
  const anchors = new Set();
  const sanitized = stripCodeBlocks(content);

  // <a id="X"></a> (HTML)
  for (const m of sanitized.matchAll(/<a\s+id="([^"]+)"\s*>\s*<\/a>/g)) {
    anchors.add(m[1]);
  }
  // <a id="X" />
  for (const m of sanitized.matchAll(/<a\s+id="([^"]+)"\s*\/?>/g)) {
    anchors.add(m[1]);
  }
  // {#X} (VitePress カスタム)
  for (const m of sanitized.matchAll(/\{#([a-zA-Z_][a-zA-Z0-9_-]*)\}/g)) {
    anchors.add(m[1]);
  }
  // 見出し行の自動 slug
  for (const m of sanitized.matchAll(/^(#+)\s+(.+?)(?:\s*\{#([^}]+)\})?\s*$/gm)) {
    const headingText = m[2].trim();
    anchors.add(slugify(headingText));
  }

  return anchors;
}

// 全 md ファイルからリンクを集める
function collectLinks(content) {
  const links = [];
  // [text](path#anchor) または [text](#anchor)
  for (const m of content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const text = m[1];
    const href = m[2];
    if (/^https?:|^mailto:/.test(href)) continue;
    if (href.startsWith('<') && href.endsWith('>')) continue;        // 角括弧で囲まれた URL
    const hashIdx = href.indexOf('#');
    if (hashIdx === -1) {
      links.push({ text, target: href, anchor: null });
    } else {
      const target = href.slice(0, hashIdx);
      const anchor = href.slice(hashIdx + 1);
      links.push({ text, target, anchor });
    }
  }
  return links;
}

// メイン処理
const fileAnchors = new Map();    // path -> Set<id>
const allFiles = [];

for (const lang of ['en', 'ja']) {
  const dirAbs = join(REPO_ROOT, 'docs', lang);
  if (!existsSync(dirAbs)) continue;
  for (const f of readdirSync(dirAbs)) {
    if (!f.endsWith('.md')) continue;
    if (f.startsWith('_')) continue;     // VitePress サイドバー除外ファイル (glossary, styleguide, sample 等)
    const path = join(dirAbs, f);
    const content = readFileSync(path, 'utf-8');
    fileAnchors.set(path, collectAnchors(content));
    allFiles.push({ path, content, dir: dirname(path) });
  }
}

const errors = [];
let totalLinks = 0;

for (const { path, content, dir } of allFiles) {
  for (const link of collectLinks(content)) {
    if (!link.anchor) continue;                                   // file-only link は別検証 (今は skip)
    if (isWhitelistedAnchor(link.anchor)) continue;
    if (link.anchor.endsWith('-marker')) continue;                // 脚注本文側 ref は別タスク (sup 復元の forward 側完了後に対応)
    totalLinks++;

    let targetPath = path;
    if (link.target && link.target !== '') {
      const cleanTarget = link.target.replace(/^\.\//, '').replace(/\.md$/, '');
      targetPath = join(dir, cleanTarget + '.md');
    }
    const targetAnchors = fileAnchors.get(targetPath);
    if (!targetAnchors) {
      errors.push({ path, link, reason: `target file not found: ${targetPath.replace(REPO_ROOT + '/', '')}` });
      continue;
    }
    if (!targetAnchors.has(link.anchor)) {
      errors.push({ path, link, reason: `anchor not defined in target: #${link.anchor}` });
    } else if (VERBOSE) {
      console.log(`  ✓ ${path.replace(REPO_ROOT + '/', '')}: [${link.text}](${link.target}#${link.anchor})`);
    }
  }
}

console.log(`\nChecked ${totalLinks} links across ${allFiles.length} files.`);
if (errors.length === 0) {
  console.log('✓ all links resolved');
  process.exit(0);
}
console.log(`✗ ${errors.length} error(s):\n`);
for (const e of errors) {
  const file = e.path.replace(REPO_ROOT + '/', '');
  console.log(`  ${file}: [${e.link.text}](${e.link.target}#${e.link.anchor})`);
  console.log(`    → ${e.reason}`);
}
process.exit(1);
