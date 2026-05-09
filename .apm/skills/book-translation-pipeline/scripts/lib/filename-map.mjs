// EPUB spine の id (or href stem) -> docs/en/ 出力ファイル名 マッピング
//
// extract-epub.mjs / fix-internal-links.mjs / inject-anchors.mjs / check-links.mjs から
// 共有して参照する Single Source of Truth。新規プロジェクトではこのファイルを
// プロジェクトの EPUB 構造に合わせて書き換える。
//
// 値の意味:
//   'NN_filename.md'  通常の出力ファイル
//   'SKIP'            spine にあるが出力しない (TOC・索引・奥付など)
//   null              cover とマージされる等の特殊扱い
//
// 確認方法:
//   1. EPUB を unzip して OEBPS/content.opf の <spine> を見る
//   2. <itemref idref="X"/> の X を href stem ('ch01', 'preface02' 等) と照合
//   3. 訳プロジェクトの命名 (NN_chapter_N.md 等) に合わせて値を埋める

export const filenameMap = {
  // 例 (apwp.epub):
  //   'cover':       'index.md',
  //   'titlepage01': null,
  //   'preface01':   '01_preface.md',
  //   'part01':      '03_part_1.md',
  //   'ch01':        '04_chapter_1.md',
  //   'ch02':        '05_chapter_2.md',
  //   'ix01':        'SKIP',
};

// xhtml stem ('ch04' 等) を MD ファイル slug ('07_chapter_4') にマップする
export function stemToSlug(stem) {
  const file = filenameMap[stem];
  if (!file || file === 'SKIP') return null;
  return file.replace(/\.md$/, '');
}
