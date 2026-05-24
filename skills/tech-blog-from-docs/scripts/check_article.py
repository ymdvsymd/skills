#!/usr/bin/env python3
"""
Tech blog article quality checker.

Runs the mechanical subset of `references/self-review.md` checks against a generated
Markdown article and emits a JSON report with pass/fail per check.

Usage:
    python check_article.py <article.md> [--reading-min N] [--out report.json]

The `--reading-min` flag sets the expected reading time target (default 30 min).
Character count tolerance is ±30% of (reading_min * 600).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


# Katakana verbs that are already naturalized into Japanese.
# These would also match `<word> + する/される`, so we don't flag them.
OK_KATAKANA_VERBS = {
    "インストール", "スキャン", "コンパイル", "マージ", "コミット",
    "リベース", "フォーマット", "ビルド", "デプロイ", "レビュー",
    "リファクタ", "リファクタリング", "パース", "ロード",
    "ダウンロード", "アップロード", "インポート", "エクスポート",
    "フェッチ", "リフレッシュ", "リトライ", "リダイレクト",
    "リネーム", "アクセス", "プッシュ", "プル", "クローン",
    "アサート", "プロセス", "リクエスト", "レスポンス", "サポート",
    "テスト", "デバッグ", "リリース", "セットアップ", "シャットダウン",
    "リスタート", "リロード", "リトリガー", "リトライ", "リダイレクト",
    "プレビュー", "サブミット", "リバート", "リフレッシュ", "リトライ",
    "シミュレート", "エミュレート", "ハイライト", "アラート", "ジャッジ",
    "コール", "プル", "プッシュ", "ストアー", "セーブ", "オープン",
    "クローズ", "リプライ", "アップデート", "アップグレード", "ハッシュ",
}


# English verbs likely to be misused as Japanese サ変動詞 (ru-go pattern).
# This is a curated detection list; matching here always flags.
RU_GO_PATTERNS = [
    r"\b(gate)\s*(する|される|した|されている)",
    r"\b(pin)\s*(する|される|した|されている)",
    r"\b(fan-out|fanout)\s*(する|される|した|されている)",
    r"\b(fail-closed|failclosed|fail-open|failopen)\s*(する|される|した|されている)",
    r"\b(embed)\s*(する|される|した|されている)",
    r"\b(intersect)\s*(する|される|した|されている)",
    r"\b(union)\s*(する|される|した|されている)",
    r"\b(scan)\s*(する|される|した|されている)",  # use 「スキャンする」 instead
    r"\b(gate|gating)\s+(が|を|に|で)\s*(走る|止まる|起きる)",  # 「gate が走る」 etc.
]


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def count_chars(text: str) -> int:
    """Count visible characters, excluding whitespace and frontmatter delimiters."""
    return len(re.sub(r"\s+", "", text))


def check_reading_length(text: str, target_min: int) -> dict:
    """Verify the character count is within ±30% of (target_min * 600)."""
    chars = count_chars(text)
    target = target_min * 600
    low = int(target * 0.7)
    high = int(target * 1.3)
    passed = low <= chars <= high
    return {
        "name": "reading_length",
        "passed": passed,
        "evidence": f"chars={chars}, target={low}-{high} (for {target_min}min @ 600char/min)",
    }


def check_why_what_how(text: str) -> dict:
    """Check for ## Why / ## What / ## How style headings."""
    why = re.search(r"^##\s+.*(Why|なぜ|why)", text, re.MULTILINE)
    what = re.search(r"^##\s+.*(What|とは|what)", text, re.MULTILINE)
    how = re.search(r"^##\s+.*(How|どう|how|使い)", text, re.MULTILINE)
    found = [name for name, m in [("Why", why), ("What", what), ("How", how)] if m]
    passed = len(found) == 3
    return {
        "name": "why_what_how_structure",
        "passed": passed,
        "evidence": f"found sections: {found}",
    }


def check_ru_go(text: str) -> dict:
    """Detect ASCII English verbs misused as Japanese サ変動詞."""
    findings: list[str] = []
    for pat in RU_GO_PATTERNS:
        for m in re.finditer(pat, text):
            ctx_start = max(0, m.start() - 20)
            ctx_end = min(len(text), m.end() + 20)
            findings.append(f"'{m.group(0)}' near '{text[ctx_start:ctx_end].strip()}'")
    passed = not findings
    return {
        "name": "no_ru_go",
        "passed": passed,
        "evidence": "no violations" if passed else f"found {len(findings)}: {findings[:5]}",
    }


def check_fenced_code_lang(text: str) -> dict:
    """All ```...``` fenced code blocks must have a language tag."""
    fences = re.findall(r"^```([^\n]*)$", text, re.MULTILINE)
    # Fences alternate: index 0 = opener, 1 = closer, 2 = opener, ...
    openers = [lang for i, lang in enumerate(fences) if i % 2 == 0]
    untagged_openers = [lang for lang in openers if not lang.strip()]
    passed = not untagged_openers
    return {
        "name": "fenced_code_lang",
        "passed": passed,
        "evidence": (
            "all blocks tagged"
            if passed
            else f"{len(untagged_openers)} untagged opening fences"
        ),
    }


def check_has_mermaid(text: str) -> dict:
    """At least one mermaid code block is present (skill convention: Mermaid for diagrams)."""
    blocks = re.findall(r"^```mermaid", text, re.MULTILINE)
    has = len(blocks) > 0
    return {
        "name": "has_mermaid_diagram",
        "passed": has,
        "evidence": f"{len(blocks)} mermaid block(s) found" if has else "no mermaid block",
    }


def check_no_ascii_tree(text: str) -> dict:
    """ASCII tree characters (├ │ └) are NOT used for diagrams (use Mermaid instead)."""
    matches = re.findall(r"[├│└]", text)
    has = len(matches) > 0
    return {
        "name": "no_ascii_tree",
        "passed": not has,
        "evidence": "no ASCII tree characters" if not has else f"{len(matches)} ASCII tree character(s) detected — use Mermaid instead",
    }


def check_mermaid_uses_br(text: str) -> dict:
    """Inside mermaid blocks, line breaks in node labels must use <br>, not \\n."""
    # Extract content of all mermaid blocks
    blocks = re.findall(r"```mermaid\n(.*?)\n```", text, re.DOTALL)
    if not blocks:
        # No mermaid blocks; this check is N/A but treat as PASS to avoid double-penalty
        return {
            "name": "mermaid_uses_br",
            "passed": True,
            "evidence": "no mermaid blocks (N/A)",
        }
    violations = []
    for i, block in enumerate(blocks):
        # Find \n inside node-label contexts: [label\n...] or "label\n..."
        if re.search(r"\\n", block):
            violations.append(f"block #{i+1}: contains literal '\\n' — should be '<br>'")
    passed = not violations
    return {
        "name": "mermaid_uses_br",
        "passed": passed,
        "evidence": "all line breaks use <br>" if passed else f"{len(violations)}: {violations[:3]}",
    }


def check_has_markdown_table(text: str) -> dict:
    """At least one Markdown table (| ... | ... |) is present."""
    has_table = bool(re.search(r"^\|.+\|.+\|", text, re.MULTILINE))
    return {
        "name": "has_markdown_table",
        "passed": has_table,
        "evidence": "table found" if has_table else "no markdown table",
    }


def check_terminology_mentions(text: str, terms: list[str], min_count: int) -> dict:
    """Verify at least `min_count` of the given terms appear in the text."""
    found = [t for t in terms if t in text]
    passed = len(found) >= min_count
    return {
        "name": "terminology_mentions",
        "passed": passed,
        "evidence": f"found {len(found)}/{len(terms)} of {terms}: {found}",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("article")
    ap.add_argument("--reading-min", type=int, default=30)
    ap.add_argument("--out")
    ap.add_argument(
        "--terms",
        nargs="*",
        default=["apm.yml", "apm.lock.yaml", "apm install", "skill", "prompt", "instruction", "MCP", "lockfile"],
    )
    ap.add_argument("--min-term-count", type=int, default=5)
    args = ap.parse_args()

    text = _read(Path(args.article))

    checks = [
        check_reading_length(text, args.reading_min),
        check_why_what_how(text),
        check_ru_go(text),
        check_fenced_code_lang(text),
        check_has_mermaid(text),
        check_no_ascii_tree(text),
        check_mermaid_uses_br(text),
        check_has_markdown_table(text),
        check_terminology_mentions(text, args.terms, args.min_term_count),
    ]

    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    report = {
        "article": str(args.article),
        "reading_target_min": args.reading_min,
        "checks": checks,
        "summary": {
            "passed": passed,
            "failed": total - passed,
            "total": total,
            "pass_rate": round(passed / total, 3),
        },
    }

    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
    else:
        print(output)

    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
