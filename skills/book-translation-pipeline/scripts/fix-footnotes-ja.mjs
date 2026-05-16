#!/usr/bin/env node
// docs/en の各ファイルから脚注の (N, id) ペアを抽出し、
// docs/ja の対応する位置にある <sup>N</sup> / [^N] / bare digit を
// EN と同じ id を使った Markdown リンクに置換する。
//
// 安全策: <sup>N</sup> 数または [^N] 数が EN refs 数と一致する場合のみ refs を置換。
// 不一致なら manual 対応のためスキップ。bodies も同様 (kind 別に厳密にマッチング)。

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const EN_DIR = join(REPO_ROOT, 'docs', 'en');
const JA_DIR = join(REPO_ROOT, 'docs', 'ja');
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

function parseEnRefs(enContent) {
  const refs = [];
  const re = /<sup><a id="([^"]+)-marker"><\/a>\[(\d+)\]\(#([^)]+)\)<\/sup>/g;
  let m;
  while ((m = re.exec(enContent)) !== null) {
    if (m[1] !== m[3]) continue;
    refs.push({ n: parseInt(m[2], 10), id: m[1] });
  }
  return refs;
}

function parseEnBodies(enContent) {
  const bodies = [];
  const re = /<sup>\[(\d+)\]\(#([^)]+)-marker\)<\/sup>/g;
  let m;
  while ((m = re.exec(enContent)) !== null) {
    bodies.push({ n: parseInt(m[1], 10), id: m[2] });
  }
  return bodies;
}

// 各 candidate strategy で JA から refs を探す。
// 順序付き配列 [{position, length, n}] を返す。

function findJaSupRefs(jaContent) {
  // <sup>N</sup> パターン (リンク無し、ref 用 = 段落途中)
  const results = [];
  const re = /<sup>(\d+)<\/sup>/g;
  let m;
  while ((m = re.exec(jaContent)) !== null) {
    const before = jaContent.slice(Math.max(0, m.index - 4), m.index);
    const isBody = /(\n\n|^|\n---\n\n)$/.test(before);
    if (isBody) continue;
    results.push({ position: m.index, length: m[0].length, n: parseInt(m[1], 10) });
  }
  return results;
}

function findJaSupBodies(jaContent) {
  // 段落先頭の <sup>N</sup>
  const results = [];
  const re = /<sup>(\d+)<\/sup>/g;
  let m;
  while ((m = re.exec(jaContent)) !== null) {
    const before = jaContent.slice(Math.max(0, m.index - 4), m.index);
    const isBody = /(\n\n|^|\n---\n\n)$/.test(before);
    if (!isBody) continue;
    results.push({ position: m.index, length: m[0].length, n: parseInt(m[1], 10) });
  }
  return results;
}

function findJaBracketRefs(jaContent) {
  // [^N] パターン (markdown footnote reference)
  const results = [];
  // [^N] but not [^N]: (which is a body definition)
  const re = /\[\^(\d+)\](?!:)/g;
  let m;
  while ((m = re.exec(jaContent)) !== null) {
    results.push({ position: m.index, length: m[0].length, n: parseInt(m[1], 10) });
  }
  return results;
}

function findJaBracketBodies(jaContent) {
  // [^N]: パターン (markdown footnote definition)
  const results = [];
  const re = /\[\^(\d+)\]:\s/g;
  let m;
  while ((m = re.exec(jaContent)) !== null) {
    results.push({ position: m.index, length: m[0].length - (m[0].endsWith(' ') ? 1 : 0), n: parseInt(m[1], 10) });
  }
  return results;
}

function findJaPlainLinkBodies(jaContent) {
  // [N](#id-marker) パターン (already has link, no <sup>)
  const results = [];
  const re = /\[(\d+)\]\(#([^)]+)-marker\)/g;
  let m;
  while ((m = re.exec(jaContent)) !== null) {
    // skip if already wrapped in <sup>
    const before = jaContent.slice(Math.max(0, m.index - 5), m.index);
    if (/<sup>$/.test(before)) continue;
    results.push({ position: m.index, length: m[0].length, n: parseInt(m[1], 10), id: m[2] });
  }
  return results;
}

function findJaBareBracketBodies(jaContent) {
  // [N] text パターン (段落先頭の plain bracket label, リンク無し)
  const results = [];
  const re = /(^|\n\n)\[(\d+)\]\s/g;
  let m;
  while ((m = re.exec(jaContent)) !== null) {
    const bracketStart = m.index + m[1].length;
    const bracketLen = m[0].length - m[1].length - 1; // exclude trailing space
    results.push({ position: bracketStart, length: bracketLen, n: parseInt(m[2], 10) });
  }
  return results;
}

function findJaBareRefs(jaContent) {
  // bare digit followed by ASCII space (matches CommonMark line break after digit)
  // 句読点 OR 」 OR ) の直後に digit、その後に半角空白 + non-digit
  const results = [];
  const re = /([、。」』）)\]"”’])(\d{1,2}) /g;
  let m;
  while ((m = re.exec(jaContent)) !== null) {
    const digitStart = m.index + m[1].length;
    results.push({ position: digitStart, length: m[2].length, n: parseInt(m[2], 10) });
  }
  return results;
}

function findJaBracketInlineRefs(jaContent) {
  // [N] (リンク無し) で段落先頭ではないもの = inline reference
  // body は段落先頭 (`\n\n[N] `) なので除外。
  const results = [];
  const re = /\[(\d+)\](?!:|\()/g;
  let m;
  while ((m = re.exec(jaContent)) !== null) {
    const before = jaContent.slice(Math.max(0, m.index - 3), m.index);
    // 段落先頭 ([N] が paragraph の冒頭) なら body
    if (/(^|\n\n)$/.test(before)) continue;
    results.push({ position: m.index, length: m[0].length, n: parseInt(m[1], 10) });
  }
  return results;
}

function numbersAlign(jaItems, enItems) {
  if (jaItems.length !== enItems.length) return false;
  for (let i = 0; i < jaItems.length; i++) {
    if (jaItems[i].n !== enItems[i].n) return false;
  }
  return true;
}

function processFile(fileName, enContent, jaContent) {
  const enRefs = parseEnRefs(enContent);
  const enBodies = parseEnBodies(enContent);
  if (enRefs.length === 0 && enBodies.length === 0) return null;

  // refs を探す: sup, then bracket [^N], then bracket inline [N], then bare digit
  let jaRefs = findJaSupRefs(jaContent);
  let refStrategy = 'sup';
  if (!numbersAlign(jaRefs, enRefs)) {
    jaRefs = findJaBracketRefs(jaContent);
    refStrategy = 'bracket';
    if (!numbersAlign(jaRefs, enRefs)) {
      jaRefs = findJaBracketInlineRefs(jaContent);
      refStrategy = 'bracket-inline';
      if (!numbersAlign(jaRefs, enRefs)) {
        jaRefs = findJaBareRefs(jaContent);
        refStrategy = 'bare';
        if (!numbersAlign(jaRefs, enRefs)) {
          jaRefs = null;
        }
      }
    }
  }

  // bodies を探す: sup-body, then bracket-body, then plain-link-body, then bare-bracket-body
  let jaBodies = findJaSupBodies(jaContent);
  let bodyStrategy = 'sup';
  if (!numbersAlign(jaBodies, enBodies)) {
    jaBodies = findJaBracketBodies(jaContent);
    bodyStrategy = 'bracket';
    if (!numbersAlign(jaBodies, enBodies)) {
      jaBodies = findJaPlainLinkBodies(jaContent);
      bodyStrategy = 'plain';
      if (!numbersAlign(jaBodies, enBodies)) {
        jaBodies = findJaBareBracketBodies(jaContent);
        bodyStrategy = 'barebracket';
        if (!numbersAlign(jaBodies, enBodies)) {
          jaBodies = null;
        }
      }
    }
  }

  const ops = [];

  if (jaRefs) {
    for (let i = 0; i < jaRefs.length; i++) {
      const replacement = '<sup><a id="' + enRefs[i].id + '-marker"></a>[' + enRefs[i].n + '](#' + enRefs[i].id + ')</sup>';
      ops.push({ position: jaRefs[i].position, length: jaRefs[i].length, replacement });
    }
  }

  if (jaBodies) {
    for (let i = 0; i < jaBodies.length; i++) {
      // 全 strategy で出力形式は同一: <sup>[N](#id-marker)</sup>
      const replacement = '<sup>[' + enBodies[i].n + '](#' + enBodies[i].id + '-marker)</sup>';
      ops.push({ position: jaBodies[i].position, length: jaBodies[i].length, replacement });
    }
  }

  // 位置降順で適用
  ops.sort((a, b) => b.position - a.position);
  let out = jaContent;
  for (const op of ops) {
    out = out.slice(0, op.position) + op.replacement + out.slice(op.position + op.length);
  }

  return {
    content: out,
    refsApplied: jaRefs ? jaRefs.length : 0,
    bodiesApplied: jaBodies ? jaBodies.length : 0,
    refsTotal: enRefs.length,
    bodiesTotal: enBodies.length,
    refStrategy: jaRefs ? refStrategy : 'NONE',
    bodyStrategy: jaBodies ? bodyStrategy : 'NONE',
  };
}

function main() {
  const enFiles = readdirSync(EN_DIR).filter(f => f.endsWith('.md') && !f.startsWith('_'));
  let totalRefs = 0, totalBodies = 0, fixedFiles = 0;
  const skipped = [];

  for (const fileName of enFiles) {
    const enPath = join(EN_DIR, fileName);
    const jaPath = join(JA_DIR, fileName);
    let jaContent;
    try { jaContent = readFileSync(jaPath, 'utf-8'); } catch { continue; }
    const enContent = readFileSync(enPath, 'utf-8');

    const r = processFile(fileName, enContent, jaContent);
    if (!r) continue;

    if (r.refsApplied + r.bodiesApplied > 0) {
      console.log('  ' + fileName + ': refs=' + r.refsApplied + '/' + r.refsTotal + ' (' + r.refStrategy + ') bodies=' + r.bodiesApplied + '/' + r.bodiesTotal + ' (' + r.bodyStrategy + ')');
      totalRefs += r.refsApplied;
      totalBodies += r.bodiesApplied;
      if (r.refsApplied === r.refsTotal && r.bodiesApplied === r.bodiesTotal) fixedFiles++;
      if (!DRY_RUN) writeFileSync(jaPath, r.content, 'utf-8');
    }
    if (r.refsApplied < r.refsTotal || r.bodiesApplied < r.bodiesTotal) {
      skipped.push({ fileName, missingRefs: r.refsTotal - r.refsApplied, missingBodies: r.bodiesTotal - r.bodiesApplied });
    }
  }

  console.log('\n' + (DRY_RUN ? '[DRY] ' : '') + 'Applied: refs=' + totalRefs + ' bodies=' + totalBodies + ' fully-fixed-files=' + fixedFiles);
  if (skipped.length) {
    console.log('\nSkipped (needs manual review):');
    for (const s of skipped) {
      console.log('  ' + s.fileName + ': missing refs=' + s.missingRefs + ' bodies=' + s.missingBodies);
    }
  }
}

main();
