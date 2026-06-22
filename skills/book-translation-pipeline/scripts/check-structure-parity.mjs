#!/usr/bin/env node
// docs/en/<file>.md と docs/ja/<file>.md の「構造パリティ」を検査する lint。
// 翻訳・校正で混入しやすい構造ドリフト (サイドバー個数不一致・コードブロック欠落・
// 見出しレベルずれ・番号リストの段落化・Recap 小見出し脱落・markdownlint 違反) を
// 機械的に検出する。translation / proof:en-ja / final の各ゲートで実行する想定。
//
// 検査項目 (hard = レンダリングを壊す / 常に 1:1 であるべき構造 ⇒ exit 1。
//           warn = cosmetic な lint・翻訳判断で正当に乖離しうる ⇒ 1 件ずつ人が精査):
//   [hard] C1 サイドバー個数    EN '^> **Sidebar:' 数 == JA '^> **コラム:' 数
//   [hard] C2 コードフェンス数  EN/JA で '```' 行数が一致
//   [hard] C3 フェンス開閉      各ファイルで '```' 行数が偶数 (閉じ忘れ検出)
//   [hard] C4 見出しレベル列    '^#{1,6}' のレベル列が EN/JA で完全一致
//   [warn] C5 MD009 行末スペース 行末スペースが 1 個 / 3 個以上 (2 個ハードブレイクは許容)。
//                               空の引用区切りは bare '>' が正準形 ('> ' は MD009 違反)。
//   [warn] C6 MD028 引用内空行   '>' 行に挟まれた空行 (隣接 admonition の境界 = 次行が '> **' は除外)
//   [warn] C7 番号リスト項目数  '^(>\s*)?\d+\.' 数の EN/JA 差 (段落化の疑い)
//   [warn] C8 引用内太字見出し  '^> **' 数の EN/JA 差 (Recap 小見出し脱落の疑い)
//   [warn] C9 継続行インデント  EN の '^>\s{4,}\S' (extract-epub fix A 回帰)
//   [hard] C10 見出し隣接の水平線 見出しの直前/直後に置かれた '---' (水平線)。VitePress
//                               デフォルトテーマは <h2> に border-top を描くため、隣接する
//                               '---' (<hr>) と線が二重に重なる。docs/{en,ja} 配下の全 .md
//                               (章・_*.md・index.md すべて) を対象に走査する。
//
// 注: C5/C6 は cosmetic な markdownlint 相当で warn 扱い。レガシー (旧 extract-epub が
//     生成した '> ' 区切り) では多数出るため、ファイル単位で件数集約する。本質的な lint 強制は
//     プロジェクト側の markdownlint 設定に委ねる。
//     C10 は章ファイルだけでなく _glossary.md / _styleguide.md / index.md 等も対象にする
//     (これらは見出し区切りに '---' を挿入しがちで、二重線が起きやすいため)。
//
// ja が未作成の章は EN 単独チェック (C3/C5/C6/C9) のみ実行し、パリティ系は skip (info)。
// proof:epub-en では `node scripts/check-structure-parity.mjs docs/en/<file>.md` で
// 生成直後の EN の回帰 (フェンス閉じ忘れ・行末スペース・継続行インデント) を検出できる。
//
// 使い方:
//   node scripts/check-structure-parity.mjs                  # docs/en の全 .md を docs/ja と対比
//   node scripts/check-structure-parity.mjs docs/en/07_x.md  # 単一ペア (en/ja/bare いずれの指定でも可)
//   node scripts/check-structure-parity.mjs 07_x.md 08_y.md  # 複数ペア
//   node scripts/check-structure-parity.mjs --verbose        # PASS も表示
//   node scripts/check-structure-parity.mjs --warnings-as-errors  # warn も exit 1 に昇格
//
// 終了コード:
//   0 = hard mismatch なし (warn のみは 0。--warnings-as-errors 時は warn でも 1)
//   1 = hard mismatch あり (または --warnings-as-errors かつ warn あり)
//   2 = 引数異常・ファイル読み込み失敗

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const WARN_AS_ERR = argv.includes('--warnings-as-errors');
const fileArgs = argv.filter((a) => !a.startsWith('--'));

// コードフェンス行 (``` 開始)。blockquote 内のフェンス (`> ```...`) も数える
// — サイドバー/Note 内のコードブロックも EN/JA で 1:1 一致すべきため。
const FENCE_RE = /^[ \t]*(?:>[ \t]?)*```/;

// --- helpers ---

function readIf(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null;
  } catch (e) {
    console.error(`read failed: ${path}: ${e.message}`);
    process.exit(2);
  }
}

// フェンス (```...```) 内の行を空行に置換しつつ行数を保持する (行番号維持・誤検出回避)。
// コード内の `# コメント`・`1.`・行末スペースを見出し/リスト/MD009 と誤検知しないため。
function stripFenceLines(lines) {
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    out.push(inFence ? '' : line);
  }
  return out;
}

function countMatches(lines, re) {
  let n = 0;
  for (const l of lines) if (re.test(l)) n++;
  return n;
}

function headingLevels(strippedLines) {
  const levels = [];
  for (const l of strippedLines) {
    const m = l.match(/^(#{1,6})\s+\S/);
    if (m) levels.push(m[1].length);
  }
  return levels;
}

// MD009: コンテンツ行の行末スペースが 1 個または 3 個以上 (2 個ハードブレイクのみ許容)。
function md009Violations(strippedLines) {
  const v = [];
  strippedLines.forEach((l, i) => {
    if (l.trim() === '') return; // 空白のみ行は対象外 (br_spaces はコンテンツ行のみ)
    const m = l.match(/( +)$/);
    if (!m) return;
    const n = m[1].length;
    if (n !== 2) v.push({ line: i + 1, n, preview: l.trimEnd().slice(0, 70) });
  });
  return v;
}

// MD028: '>' 行に挟まれた空行 (単一 blockquote 内の空白行)。
// 次行が新しい admonition / サイドバータイトル ('> **...') の場合は、別ブロックの正当な境界
// (Tip→Note→Warning の連続など) なので除外する。
function md028Violations(strippedLines) {
  const v = [];
  for (let i = 1; i < strippedLines.length - 1; i++) {
    if (strippedLines[i].trim() !== '') continue; // blank
    const prev = strippedLines[i - 1];
    const next = strippedLines[i + 1];
    if (!/^>/.test(prev) || !/^>/.test(next)) continue;
    if (/^>\s*\*\*/.test(next)) continue; // 次行が新 admonition タイトル → 正当な境界
    v.push({ line: i + 1 });
  }
  return v;
}

// 継続行インデント (extract-epub fix A 回帰): blockquote 内に 4 スペース以上の本文インデント。
function continuationIndent(strippedLines) {
  const v = [];
  strippedLines.forEach((l, i) => {
    if (/^>\s{4,}\S/.test(l)) v.push({ line: i + 1, preview: l.slice(0, 70) });
  });
  return v;
}

// C10: 見出しに隣接した水平線 '---' を検出する。VitePress の <h2> は border-top を持つため、
// 隣接する <hr> と線が二重に表示される。生の行配列を受け取り (フェンス内 '---' を誤検出しない
// よう内部で stripFenceLines する)、問題行を返す。
//   - 先頭の YAML frontmatter 区切り (--- ... ---) は除外
//   - setext 見出しの下線 (直前行が空でない非見出しテキスト = 段落の見出し化) は除外
//   - 「直前 or 直後の非空行が ATX 見出し (#..######)」のときのみ違反
function thematicBreakNearHeading(rawLines) {
  const s = stripFenceLines(rawLines);
  const isHR = (l) => /^---+\s*$/.test(l ?? '');
  const isHeading = (l) => /^#{1,6}\s+\S/.test(l ?? '');
  const isBlank = (l) => /^\s*$/.test(l ?? '');
  // 先頭 frontmatter の閉じ '---' 位置 (あれば) を特定して除外する。
  let fmClose = -1;
  if (isHR(s[0])) {
    for (let j = 1; j < Math.min(s.length, 40); j++) { if (isHR(s[j])) { fmClose = j; break; } }
  }
  const hits = [];
  for (let i = 0; i < s.length; i++) {
    if (!isHR(s[i])) continue;
    if (i === 0 || i === fmClose) continue; // frontmatter 区切り
    // setext 下線判定: 直前行が空でなく見出しでもないテキストなら、これは <hr> ではなく見出し下線。
    const prevImmediate = i === 0 ? '' : s[i - 1];
    if (!isBlank(prevImmediate) && !isHeading(prevImmediate)) continue;
    let prev = null; for (let j = i - 1; j >= 0; j--) if (!isBlank(s[j])) { prev = s[j]; break; }
    let next = null; for (let j = i + 1; j < s.length; j++) if (!isBlank(s[j])) { next = s[j]; break; }
    if (isHeading(prev) || isHeading(next)) {
      const heading = isHeading(next) ? next : prev;
      hits.push({ line: i + 1, heading: heading.trim().slice(0, 50) });
    }
  }
  return hits;
}

// --- 検査対象ペアの解決 ---

// 抽出章のみを対象にする。除外:
//   _*.md     用語集・スタイルガイド等 (VitePress サイドバーからも除外される)
//   index.md  VitePress の landing page (カバー画像 / 手書き TOC)。EPUB から抽出した章ではなく
//             en/ja で構造が意図的に異なる (EN=カバー画像のみ・JA=翻訳済み目次) ため、
//             見出し/フェンスのパリティ対象にすると恒常的な false positive になる。
const isChapterFile = (base) =>
  base.endsWith('.md') && !base.startsWith('_') && base !== 'index.md';

function resolvePairs() {
  if (fileArgs.length) {
    const seen = new Set();
    const out = [];
    for (const a of fileArgs) {
      const base = basename(a).replace(/\.md$/, '') + '.md';
      if (!isChapterFile(base)) continue;
      if (seen.has(base)) continue;
      seen.add(base);
      out.push(base);
    }
    return out;
  }
  const enDir = join(REPO_ROOT, 'docs', 'en');
  if (!existsSync(enDir)) return [];
  // SKILL.md の不変条件: docs/en と docs/ja は同名ファイルで 1:1 対応 (ASCII ソート順一致)。
  return readdirSync(enDir).filter(isChapterFile).sort();
}

// --- 単一ペアの検査 ---

function checkPair(base) {
  const enPath = join(REPO_ROOT, 'docs', 'en', base);
  const jaPath = join(REPO_ROOT, 'docs', 'ja', base);
  const enText = readIf(enPath);
  const jaText = readIf(jaPath);

  const findings = []; // { level: 'hard'|'warn'|'info', code, msg }

  if (enText == null && jaText == null) {
    findings.push({ level: 'info', code: '--', msg: `en/ja どちらも見つからない: ${base}` });
    return { base, findings };
  }

  const enRaw = enText == null ? null : enText.split('\n');
  const jaRaw = jaText == null ? null : jaText.split('\n');
  const enS = enRaw == null ? null : stripFenceLines(enRaw);
  const jaS = jaRaw == null ? null : stripFenceLines(jaRaw);

  // --- EN/JA それぞれの intrinsic チェック (相手が無くても走る) ---
  for (const [lang, raw, s] of [
    ['EN', enRaw, enS],
    ['JA', jaRaw, jaS],
  ]) {
    if (raw == null) continue;
    // C3 フェンス開閉 (hard)
    const fences = countMatches(raw, FENCE_RE);
    if (fences % 2 !== 0) {
      findings.push({ level: 'hard', code: 'C3', msg: `フェンス開閉が奇数 (${lang}): ${fences} 個 — 閉じ忘れの疑い` });
    }
    // C5 MD009 (warn・ファイル単位で集約)
    const md009 = md009Violations(s);
    if (md009.length) {
      const sample = md009.slice(0, 5).map((x) => `L${x.line}`).join(',') + (md009.length > 5 ? ',…' : '');
      findings.push({ level: 'warn', code: 'C5', msg: `MD009 行末スペース ${md009.length}行 (${lang}: ${sample}) ※warn: 空区切りは bare '>' 推奨・markdownlint --fix で一括修正可` });
    }
    // C6 MD028 (warn・ファイル単位で集約)
    const md028 = md028Violations(s);
    if (md028.length) {
      const sample = md028.slice(0, 5).map((x) => `L${x.line}`).join(',') + (md028.length > 5 ? ',…' : '');
      findings.push({ level: 'warn', code: 'C6', msg: `MD028 引用内の空行 ${md028.length}件 (${lang}: ${sample}) ※warn: 単一サイドバー内に空行を入れない` });
    }
  }
  // C9 継続行インデント (EN のみ — 生成物の回帰検出)
  if (enS) {
    for (const x of continuationIndent(enS)) {
      findings.push({ level: 'warn', code: 'C9', msg: `継続行インデント (EN L${x.line}): "${x.preview}" ※warn: extract-epub fix A 回帰の疑い` });
    }
  }

  // --- パリティ系 (en/ja 両方が存在するときのみ) ---
  if (enS && jaS) {
    // C1 サイドバー個数
    const enSb = countMatches(enS, /^>\s*\*\*Sidebar:/);
    const jaSb = countMatches(jaS, /^>\s*\*\*コラム:/);
    if (enSb !== jaSb) {
      findings.push({ level: 'hard', code: 'C1', msg: `サイドバー個数 MISMATCH: EN(Sidebar)=${enSb} JA(コラム)=${jaSb}` });
    } else if (VERBOSE) {
      findings.push({ level: 'info', code: 'C1', msg: `サイドバー個数 OK: ${enSb}` });
    }
    // C2 コードフェンス数
    const enF = countMatches(enRaw, FENCE_RE);
    const jaF = countMatches(jaRaw, FENCE_RE);
    if (enF !== jaF) {
      findings.push({ level: 'hard', code: 'C2', msg: `コードフェンス数 MISMATCH: EN=${enF} JA=${jaF}` });
    } else if (VERBOSE) {
      findings.push({ level: 'info', code: 'C2', msg: `コードフェンス数 OK: ${enF}` });
    }
    // C4 見出しレベル列
    const enH = headingLevels(enS);
    const jaH = headingLevels(jaS);
    if (enH.length !== jaH.length) {
      findings.push({ level: 'hard', code: 'C4', msg: `見出し数 MISMATCH: EN=${enH.length} JA=${jaH.length} (EN列=[${enH.join(',')}] JA列=[${jaH.join(',')}])` });
    } else {
      const i = enH.findIndex((lv, idx) => lv !== jaH[idx]);
      if (i !== -1) {
        findings.push({ level: 'hard', code: 'C4', msg: `見出しレベル不一致: index ${i} で EN=h${enH[i]} JA=h${jaH[i]} (EN列=[${enH.join(',')}] JA列=[${jaH.join(',')}])` });
      } else if (VERBOSE) {
        findings.push({ level: 'info', code: 'C4', msg: `見出しレベル列 OK: [${enH.join(',')}]` });
      }
    }
    // C7 番号付きリスト項目数 (blockquote 内の '> 1.' も含む)
    const numRe = /^(?:>\s*)?\d+\.\s/;
    const enN = countMatches(enS, numRe);
    const jaN = countMatches(jaS, numRe);
    if (enN !== jaN) {
      findings.push({ level: 'warn', code: 'C7', msg: `番号リスト項目数 差: EN=${enN} JA=${jaN} ※warn: 段落化の疑い (翻訳判断による正当な乖離もありうる)` });
    }
    // C8 blockquote 内太字見出し数 (サイドバータイトル + Recap 小見出し)
    const enB = countMatches(enS, /^>\s*\*\*/);
    const jaB = countMatches(jaS, /^>\s*\*\*/);
    if (enB !== jaB) {
      findings.push({ level: 'warn', code: 'C8', msg: `引用内太字見出し数 差: EN=${enB} JA=${jaB} ※warn: Recap 小見出し脱落の疑い (翻訳判断による正当な乖離もありうる)` });
    }
  } else {
    const missing = enS ? 'ja' : 'en';
    findings.push({ level: 'info', code: '--', msg: `${missing} が未作成 — パリティ系 (C1/C2/C4/C7/C8) を skip し EN 単独チェックのみ実行` });
  }

  return { base, findings };
}

// C10 の走査対象を解決する。章ペアと違い _*.md / index.md も含む docs/{en,ja} 全 .md が対象。
// fileArgs 指定時は basename を en/ja 両ディレクトリで照合する (どちらか存在する側を検査)。
function resolveC10Targets() {
  const dirs = [join(REPO_ROOT, 'docs', 'en'), join(REPO_ROOT, 'docs', 'ja')];
  const out = [];
  const seen = new Set();
  const add = (p) => { if (existsSync(p) && !seen.has(p)) { seen.add(p); out.push(p); } };
  if (fileArgs.length) {
    for (const a of fileArgs) {
      const base = basename(a).replace(/\.md$/, '') + '.md';
      for (const d of dirs) add(join(d, base));
    }
  } else {
    for (const d of dirs) {
      if (!existsSync(d)) continue;
      for (const e of readdirSync(d).filter((f) => f.endsWith('.md')).sort()) add(join(d, e));
    }
  }
  return out;
}

// --- メイン ---

const pairs = resolvePairs();

let hardTotal = 0;
let warnTotal = 0;
let checked = 0;

for (const base of pairs) {
  const { findings } = checkPair(base);
  const hard = findings.filter((f) => f.level === 'hard');
  const warn = findings.filter((f) => f.level === 'warn');
  const info = findings.filter((f) => f.level === 'info');
  hardTotal += hard.length;
  warnTotal += warn.length;
  checked++;

  const show = hard.length || warn.length || VERBOSE;
  if (!show && info.length === 0) continue;
  if (!show && !VERBOSE) continue;

  console.log(`=== ${base} ===`);
  for (const f of hard) console.log(`  [hard] ${f.code} ${f.msg}`);
  for (const f of warn) console.log(`  [warn] ${f.code} ${f.msg}`);
  if (VERBOSE) for (const f of info) console.log(`  [info] ${f.code} ${f.msg}`);
}

// C10 見出し隣接の水平線 (章・_*.md・index.md 横断)
let c10Total = 0;
for (const path of resolveC10Targets()) {
  const text = readIf(path);
  if (text == null) continue;
  const hits = thematicBreakNearHeading(text.split('\n'));
  if (!hits.length) continue;
  c10Total += hits.length;
  hardTotal += hits.length;
  const rel = path.slice(REPO_ROOT.length + 1);
  console.log(`=== ${rel} ===`);
  for (const h of hits) {
    console.log(`  [hard] C10 見出し隣接の水平線 (L${h.line}): "---" が見出し "${h.heading}" に隣接 — VitePress で線が二重になる。'---' を削除 (見出しの border が区切りになる)`);
  }
}

if (pairs.length === 0 && c10Total === 0) {
  console.log('対象の en/ja ペアが見つかりませんでした (docs/en/*.md なし)。');
  process.exit(0);
}

console.log(`\nChecked ${checked} pair(s).  hard: ${hardTotal} fail (うち C10 水平線: ${c10Total}) / warn: ${warnTotal}`);
if (hardTotal > 0) {
  console.log('✗ 構造パリティに hard mismatch があります (上記を修正)。');
  process.exit(1);
}
if (warnTotal > 0) {
  console.log(`△ warn ${warnTotal} 件: 翻訳判断による正当な乖離か、構造脱落かを 1 件ずつ精査してください。`);
  if (WARN_AS_ERR) process.exit(1);
}
console.log('✓ hard mismatch なし');
process.exit(0);
