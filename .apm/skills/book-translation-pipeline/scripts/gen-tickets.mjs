#!/usr/bin/env node
// docs/en/ 配下の Markdown ファイルから翻訳タスクの beads チケット体系を生成する。
// (book-translation-pipeline skill テンプレート)
//
// 生成チケット体系:
//   Epic           - 全章翻訳の親チケット
//   Setup          - s1: ディレクトリ準備, s2: 用語集, s3: スタイルガイド, s4: 翻訳サンプル品質確認
//   Translation    - 1チケット/ファイル (s1-s4 完了が前提)
//   Proof:EPUB-EN  - 1チケット/ファイル (Setup と独立に並列実行可、抽出MDの構造校正)
//   Proof:EN-JA    - 1チケット/ファイル (対応 translation 完了が前提、訳文の品質校正)
//   Final          - VitePress ビルド確認 + 全体目視 (全 translation + proof:en-ja 完了が前提)
//
// 詳細: book-translation-pipeline skill の references/gen-tickets-customization.md
//
// 使い方:
//   node scripts/gen-tickets.mjs           # 本番実行
//   node scripts/gen-tickets.mjs --dry-run # チケット内容を表示のみ

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ====================== CONFIG (書き換え対象) ======================
const CONFIG = {
  // Epic タイトル (書籍名込み)
  epicTitle: 'docs/en/ の全章を日本語化 (TODO_FILL)',

  // 書籍書誌情報 (Epic description に埋める)
  bookCitation: 'TODO_FILL (Author, Publisher YYYY, ISBN XXXX)',

  // 本編章タイトル対応表 (連番接頭辞付き stem → 「第N章 日本語タイトル」)
  // 例 (DMRB-Vol2):
  //   '04_introduction':              '第1章 はじめに',
  //   '05_manufacturing':             '第2章 製造業',
  chapterTitleJa: {
    // 'NN_stem': '第N章 タイトル',
  },

  // 前付け・付録・補足タイトル対応表 (連番接頭辞付き stem → 表記)
  // 例 (DMRB-Vol2):
  //   '01_foreword':         '序文 (Foreword)',
  //   '14_appendix-a':       '付録A 製造業のエンティティと属性',
  specialTitleJa: {
    // 'NN_stem': '前付け/付録/補足 タイトル',
  },

  // 本編の最初のファイルが第何章に対応するか (seqNum - chapterOffset = 章番号)
  // 例: '04_introduction' が第1章なら chapterOffset = 3
  chapterOffset: 0,

  // P1 (高優先度) チケットにする stem の配列
  // 序文・第1章・最終章・代表分野などを入れる
  prioritizeP1: [
    // '01_foreword', '04_introduction',
  ],

  // Setup s2 (用語集) のヒント文 — 書籍ジャンル別の用語カテゴリリスト
  // references/glossary-template.md と連動
  glossarySetupHint: '書籍ジャンル特有の用語カテゴリを列挙してください (例: ドメイン用語、業界用語、頻出概念)',

  // proof フェーズの種類
  //   'full'        proof:epub-en + proof:en-ja の両方を生成 (DMRB系)
  //   'epub-only'   proof:epub-en のみ
  //   'none'        proof フェーズなし (a-philosophy 1u2 epic タイプ)
  proofPhase: 'full',

  // ファイルサイズ分類 (行数閾値)
  sizeBuckets: { small: 50, medium: 300 },
};
// =================== ここから下は基本変更不要 ===================

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const EN_DIR = join(REPO_ROOT, 'docs', 'en');
const DRY_RUN = process.argv.includes('--dry-run');

const CHAPTER_TITLE_JA = CONFIG.chapterTitleJa;
const SPECIAL_TITLE_JA = CONFIG.specialTitleJa;

// サイズ分類
function sizeBucket(lines) {
  if (lines <= CONFIG.sizeBuckets.small)  return 'small';
  if (lines <= CONFIG.sizeBuckets.medium) return 'medium';
  return 'large';
}

// ファイル名 (拡張子なし) から章情報を取得
function classifyFile(stem) {
  const seqMatch = stem.match(/^(\d+)_/);
  const seqNum = seqMatch ? parseInt(seqMatch[1], 10) : null;
  const isMain = stem in CHAPTER_TITLE_JA;
  const chNum = isMain && seqNum !== null ? seqNum - CONFIG.chapterOffset : null;
  const titleJa = CHAPTER_TITLE_JA[stem] || SPECIAL_TITLE_JA[stem] || stem;
  return { stem, seqNum, chNum, titleJa, isMain };
}

// docs/en/ をスキャン
function scanDocs() {
  if (!existsSync(EN_DIR)) {
    console.error(`Error: docs/en/ not found. Run extract-epub.mjs first.`);
    process.exit(1);
  }

  const files = readdirSync(EN_DIR)
    .filter(f => f.endsWith('.md'))
    .filter(f => f !== 'index.md')
    .sort();

  return files.map(f => {
    const stem = f.replace(/\.md$/, '');
    const content = readFileSync(join(EN_DIR, f), 'utf-8');
    const lines = content.split('\n').length;
    const info = classifyFile(stem);
    return { file: f, stem, lines, size: sizeBucket(lines), ...info };
  });
}

// 優先度を決定
function prioritize(stem) {
  return CONFIG.prioritizeP1.includes(stem) ? 1 : 2;
}

// proof:epub-en の説明本文
const PROOF_EPUB_CHECKLIST = `## 校正観点 (8項目すべて確認)

1. **構造保持**: H1〜H4 が原文 XHTML の \`p.chaptertitle\` / \`p.h1\`〜\`p.h5\` と一致しているか
2. **段落の欠落なし**: 原文 \`<p>\` の段落・センテンスが脱落していないか
3. **画像参照**: \`![alt](./images/...)\` の参照先が \`docs/en/images/\` に実在するか
4. **表組み**: パイプ記法に列ずれ・セル抜けがないか
5. **特殊ブロック**: Note (\`> **Note**\`) / figurecaption (\`*Figure X.X*\`) / tablecaption が保持されているか
6. **インライン書式**: \`**bold**\` / \`*italic*\` / \`<sup>\` が原文 HTML 由来で正しく対応しているか
7. **エンティティ展開**: \`&amp;\` / \`&mdash;\` 等が Unicode に展開されているか
8. **ノイズ混入なし**: 著作権表示・ページ番号・CSS 残骸が本文に紛れていないか

## 進め方

1. \`docs/en/<file>.md\` を冒頭から末尾まで通読
2. EPUB 内の対応 HTML と必要に応じて対比
3. 軽微な問題は \`docs/en/<file>.md\` に直接修正、構造的な不具合は \`scripts/extract-epub.mjs\` の修正 follow-up を起票
4. notes に発見した問題と対応を簡潔に記録`;

// proof:en-ja の説明本文
const PROOF_JA_CHECKLIST = `## 校正観点 (9項目すべて確認)

1. **訳漏れなし**: 原文の段落・見出しが全て訳出されているか
2. **誤訳なし**: 主述・否定・複数形・受動態の誤読がないか、専門用語の文脈解釈が正しいか
3. **用語一貫性**: \`docs/ja/_glossary.md\` 記載用語の表記が統一されているか
4. **文体**: である調統一、「です」「ます」「だろう」が混入していないか
5. **Markdown 構造**: 見出しレベル・リスト・表・画像 alt が原文と完全一致しているか
6. **図表参照**: 「図N.N」「表N.N」「第N章」表記が統一されているか
7. **原文維持**: コードブロック・SQL・カラム名・書名・著者名は翻訳していないか
8. **数値・年号**: 数値・日付・パーセント表記が原文と一致しているか
9. **日本語表現の自然さ**: 直訳臭・てにをは・主述ねじれ・読点配置・カタカナ漢語の混在を是正、用語の現代的妥当性 (例: "後付" は誤り → "巻末") を確認 (詳細: book-translation-pipeline skill の references/proof-en-ja-checklist.md #9)

## 進め方

1. \`docs/en/<file>.md\` と \`docs/ja/<file>.md\` を並べて対比
2. 観点 1〜9 を順に確認 (1〜8 は原文整合、9 は日本語表現の自然さ)
3. 問題箇所は \`docs/ja/<file>.md\` に直接修正
4. notes に修正した観点と件数を簡潔に記録 (例: \`#9 候補12件中8件修正\`)`;

// bd create を実行して ID を返す
let dryCounter = 0;
function createIssue({ title, description, type = 'task', priority = 2, labels = [], parent = '', deps = [], acceptance = '', design = '', notes = '' }) {
  const args = [
    'create',
    '--title', title,
    '--description', description,
    '--type', type,
    '--priority', String(priority),
  ];

  if (labels.length)    args.push('--labels', labels.join(','));
  if (parent)           args.push('--parent', parent);
  if (deps.length)      args.push('--deps', deps.join(','));
  if (acceptance)       args.push('--acceptance', acceptance);
  if (design)           args.push('--design', design);
  if (notes)            args.push('--notes', notes);
  args.push('--silent');

  if (DRY_RUN) {
    args.push('--dry-run');
    const id = `DRY-${String(++dryCounter).padStart(3, '0')}`;
    console.log(`[DRY] bd ${args.join(' ')}`);
    return id;
  }

  const r = spawnSync('bd', args, { encoding: 'utf-8' });
  if (r.status !== 0) {
    console.error(`Error creating issue: ${title}`);
    console.error(r.stderr || r.stdout || '');
    process.exit(1);
  }
  const out = (r.stdout || '').trim();
  const lastLine = out.split('\n').pop()?.trim() || '';
  const idMatch = lastLine.match(/\S+$/);
  return idMatch ? idMatch[0] : lastLine;
}

// --- メイン ---

async function main() {
  if (Object.keys(CONFIG.chapterTitleJa).length === 0 && Object.keys(CONFIG.specialTitleJa).length === 0) {
    console.error('Error: CONFIG.chapterTitleJa / specialTitleJa が空です。');
    console.error('See: book-translation-pipeline skill の references/gen-tickets-customization.md');
    process.exit(1);
  }

  const files = scanDocs();
  const mainChapters = files.filter(f => f.isMain);
  const others = files.filter(f => !f.isMain);
  const translationTargets = [...mainChapters, ...others];

  console.log(`Found ${files.length} files in docs/en/ (${mainChapters.length} chapters, ${others.length} special)`);
  if (DRY_RUN) console.log('[DRY RUN MODE]\n');

  // === Epic ===
  const epicId = createIssue({
    title: CONFIG.epicTitle,
    description: `${CONFIG.bookCitation} の英語原文 (docs/en/) を日本語訳 (docs/ja/) に翻訳する。

## 現状
- 翻訳対象: ${mainChapters.length} 章 + ${others.length} 特別セクション (前付け / 付録 / 参考文献)
- 英語原文: docs/en/ (extract-epub.mjs で生成)
- 出力先: docs/ja/

## 翻訳方針
- 文体: である調
- 用語集: docs/ja/_glossary.md に準拠
- スタイルガイド: docs/ja/_styleguide.md に準拠
- 書名・著者名・出版社名は原文のまま (翻訳しない)

## チケットフェーズ
1. setup (s1→s2→s3→s4 の順に直列)
2. proof:epub-en (Setup と独立に並列実行可)${CONFIG.proofPhase === 'none' ? ' [skipped: proofPhase=none]' : ''}
3. translation (s4 完了が前提、章ごとに並列実行)
4. proof:en-ja (各 translation 完了が前提)${CONFIG.proofPhase !== 'full' ? ' [skipped]' : ''}
5. final (全 translation + 全 proof 完了が前提)`,
    type: 'epic',
    priority: 1,
    labels: ['translation', 'epic'],
    acceptance: 'npm run build が成功し、全章の日本語版が docs/ja/ に存在すること。全 proof チケットが close され、本書の品質基準を満たすこと。',
  });
  console.log(`Epic: ${epicId}`);

  // === Setup チケット (4件) ===
  const s1 = createIssue({
    title: 'setup: docs/ja/ ディレクトリ構造の整備確認',
    description: `翻訳作業の前提として docs/ja/ の構造を確認・整備する。

## 作業内容
1. docs/ja/ ディレクトリの存在確認
2. docs/ja/index.md (日本語トップページ) の存在確認・必要に応じて修正
3. VitePress サイドバーの ja セクションが全 ${mainChapters.length} 章+特別セクション ${others.length} を含むか確認 (docs/.vitepress/config.mts)
4. \`npm run dev\` で日本語トップページが表示されることを確認`,
    type: 'task',
    priority: 1,
    parent: epicId,
    labels: ['setup', 'translation'],
    acceptance: `docs/ja/index.md が表示され、サイドバーに全 ${translationTargets.length} 翻訳ターゲットへのリンクが存在すること。`,
  });

  const s2 = createIssue({
    title: 'setup: docs/ja/_glossary.md の確定',
    description: `翻訳全体で使用する用語集を確定する。

## 作業内容
1. docs/ja/_glossary.md の既存内容を確認 (テンプレートまたは関連書籍由来の用語)
2. 本書で新出する用語を追記
3. 全 ${translationTargets.length} 翻訳ターゲットのタイトル日本語訳が定義されているか確認
4. 不足があれば追記

## 用語カテゴリのヒント
${CONFIG.glossarySetupHint}

## 参考
- references/glossary-template.md (skill 内テンプレート)`,
    type: 'task',
    priority: 1,
    parent: epicId,
    labels: ['setup', 'translation'],
    acceptance: '_glossary.md が本書の主要用語をカバーし、全翻訳ターゲットのタイトル訳が定義されていること。',
  });

  const s3 = createIssue({
    title: 'setup: docs/ja/_styleguide.md の確定',
    description: `翻訳全体の文体・Markdown 規約を確定する。

## 主要規約
- 文体: である調 (「です・ます」禁止)
- 人称: 「我々」「あなた」、または主語省略
- Markdown 構造: 英語版と同一の見出しレベルを保持
- コードブロック: 訳さない (SQL・カラム名・テーブル名・属性名を維持)
- 画像参照: ./images/ のまま
- 用語: _glossary.md に準拠
- 図表参照: 「図N.N」「表N.N」「第N章」「付録N」
- 書名・著者名・出版社名: 原文のまま維持

## 参考
- references/styleguide-template.md (skill 内テンプレート)`,
    type: 'task',
    priority: 1,
    parent: epicId,
    labels: ['setup', 'translation'],
    acceptance: '_styleguide.md が確定し、文体・用語・Markdown 規約が文書化されていること。',
  });

  const s4 = createIssue({
    title: 'setup: 翻訳サンプル品質確認 (_sample.md)',
    description: `翻訳開始前に1パッセージ翻訳して品質基準が確立されているか確認する。

## 作業内容
1. 代表章 (推奨: 序文または introduction) の冒頭1セクションを選定
2. _glossary.md / _styleguide.md に従って翻訳
3. docs/ja/_sample.md に保存
4. 8観点 (proof:en-ja の校正観点) でセルフチェック
5. Go 判定: 8観点をクリアしていれば translation フェーズ着手可

## Go 判定基準
- 訳漏れなし、誤訳なし
- 用語一貫性 (_glossary.md 準拠)
- である調統一
- Markdown 構造保持
- 図表参照の表記統一`,
    type: 'task',
    priority: 1,
    parent: epicId,
    labels: ['setup', 'translation'],
    deps: [s1, s2, s3],
    acceptance: '_sample.md が作成され、8観点クリアの Go 判定が notes に記録されていること。',
  });

  console.log(`Setup: ${s1}, ${s2}, ${s3}, ${s4}`);
  const setupDeps = [s1, s2, s3, s4];

  // === Translation チケット ===
  const transIds = [];
  for (const f of translationTargets) {
    const priority = prioritize(f.stem);
    const titleJa = f.titleJa;
    const id = createIssue({
      title: `翻訳: ${f.file} (${titleJa}, ${f.lines}行, ${f.size})`,
      description: `docs/en/${f.file} を日本語訳して docs/ja/${f.file} を作成する。

## ソース情報
- ファイル: docs/en/${f.file}
- 行数: ${f.lines} 行 (${f.size})
- 章タイトル (日本語): ${titleJa}

## 作業手順
1. docs/en/${f.file} を冒頭から末尾まで通読
2. docs/ja/_glossary.md の用語集を参照
3. docs/ja/_styleguide.md の規約に従って翻訳
4. docs/ja/${f.file} として保存
5. セルフチェック: である調統一・用語一貫性・Markdown 構造保持・書名/著者名は原文維持`,
      type: 'task',
      priority,
      parent: epicId,
      labels: ['translation', `size:${f.size}`, ...(f.chNum !== null ? [`chapter:${String(f.chNum).padStart(2, '0')}`] : []), `seq:${String(f.seqNum).padStart(2, '0')}`],
      deps: setupDeps,
      acceptance: `docs/ja/${f.file} が作成され、である調・用語集準拠・Markdown 構造保持が確認されていること。`,
    });
    transIds.push(id);
    console.log(`  Trans: ${id} — ${f.file}`);
  }

  // === Proof:EPUB-EN チケット (deps なし、Setup と独立に並列実行可) ===
  const proofEpubIds = [];
  if (CONFIG.proofPhase === 'full' || CONFIG.proofPhase === 'epub-only') {
    for (const f of translationTargets) {
      const priority = prioritize(f.stem);
      const titleJa = f.titleJa;
      const id = createIssue({
        title: `校正(EPUB-EN): ${f.file} 抽出 MD の構造校正`,
        description: `docs/en/${f.file} を 8観点で校正し、抽出スクリプト (extract-epub.mjs) の出力品質を検証する。

## ソース情報
- ファイル: docs/en/${f.file}
- 行数: ${f.lines} 行 (${f.size})
- 対応章: ${titleJa}

${PROOF_EPUB_CHECKLIST}`,
        type: 'task',
        priority,
        parent: epicId,
        labels: ['proof:epub-en', `size:${f.size}`, ...(f.chNum !== null ? [`chapter:${String(f.chNum).padStart(2, '0')}`] : []), `seq:${String(f.seqNum).padStart(2, '0')}`],
        acceptance: '校正観点 8項目すべてクリアしていることを notes に記録すること。問題があれば修正済み、または follow-up チケットを起票していること。',
      });
      proofEpubIds.push(id);
      console.log(`  ProofEpub: ${id} — ${f.file}`);
    }
  } else {
    console.log(`  ProofEpub: skipped (CONFIG.proofPhase=${CONFIG.proofPhase})`);
  }

  // === Proof:EN-JA チケット (対応 translation を deps とする) ===
  const proofJaIds = [];
  if (CONFIG.proofPhase === 'full') {
    for (let i = 0; i < translationTargets.length; i++) {
      const f = translationTargets[i];
      const priority = prioritize(f.stem);
      const titleJa = f.titleJa;
      const id = createIssue({
        title: `校正(EN-JA): ${f.file} 翻訳の品質校正`,
        description: `docs/en/${f.file} と docs/ja/${f.file} を対比し、翻訳品質を 8観点で校正する。

## ソース情報
- 原文: docs/en/${f.file}
- 訳文: docs/ja/${f.file}
- 行数: ${f.lines} 行 (${f.size})
- 章タイトル: ${titleJa}

${PROOF_JA_CHECKLIST}`,
        type: 'task',
        priority,
        parent: epicId,
        labels: ['proof:en-ja', `size:${f.size}`, ...(f.chNum !== null ? [`chapter:${String(f.chNum).padStart(2, '0')}`] : []), `seq:${String(f.seqNum).padStart(2, '0')}`],
        deps: [transIds[i]],
        acceptance: '校正観点 8項目すべてクリアしていることを notes に記録すること。問題箇所は docs/ja/ に直接修正済みであること。',
      });
      proofJaIds.push(id);
      console.log(`  ProofJa:   ${id} — ${f.file}`);
    }
  } else {
    console.log(`  ProofJa: skipped (CONFIG.proofPhase=${CONFIG.proofPhase})`);
  }

  // === Final チケット ===
  const finalDeps = [...transIds, ...proofJaIds];
  const finalId = createIssue({
    title: 'final: VitePress ビルド確認 + 全体目視レビュー',
    description: `全翻訳・全校正完了後の最終検証を行う。

## チェック項目
1. \`npm run build\` が成功すること
2. 全 docs/ja/*.md (${translationTargets.length} ファイル) が存在すること
3. 画像参照 ./images/ が正常 (リンク切れなし)
4. 用語一貫性: \`_glossary.md\` 記載用語が全章で統一されていること
5. 文体: \`grep -c "です。\\|ます。" docs/ja/*.md\` で逸脱がないこと
6. 代表章を目視確認
7. \`docs/ja/_sample.md\` の Go 判定が保持されていること`,
    type: 'task',
    priority: 1,
    parent: epicId,
    labels: ['final', 'translation'],
    deps: finalDeps,
    acceptance: `npm run build が成功し、全 ${translationTargets.length} 翻訳ターゲットの日本語版が VitePress 上で正常表示されること。`,
  });

  console.log(`Final: ${finalId}`);

  // サマリー
  const total = 1 + 4 + transIds.length + proofEpubIds.length + proofJaIds.length + 1;
  console.log(`
${DRY_RUN ? '[DRY RUN] ' : ''}チケット生成完了:
  Epic:           ${epicId}
  Setup:          ${s1}, ${s2}, ${s3}, ${s4}
  Translation:    ${transIds.length} チケット
  Proof:EPUB-EN:  ${proofEpubIds.length} チケット
  Proof:EN-JA:    ${proofJaIds.length} チケット
  Final:          ${finalId}
  合計:           ${total} チケット
`);
}

main().catch(e => { console.error(e); process.exit(1); });
