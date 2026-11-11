"""Build a session's combat-log.html from its combat-stats.md.

The combat report is written once, as markdown; this lays it into the printed report's page
(the skill's templates/combat-log.html: its stylesheet, its .keep groups, its bar figures), so
the HTML, the PDF and the journal page all come from the same words and numbers.

usage: python scripts/combat-log-build.py <combat-stats.md> <combat-log.html> [--campaign <name>]

The markdown it reads:

  # Combat stats — Session 4 · The Spring Feast (2026-11-10)

  Source: ... one paragraph: where the numbers come from, how many combats, how many rounds.

  > **The headline claim, in numbers.** Its evidence.          <- the lead callout

  ## 1 · Totals                                                <- "N · Title" sections
  ```bars Damage dealt by the party, both fights              <- a bar figure: caption on the fence
  Kartor (axe, two smites) | 47                                <- name | value [| label]
  Lysandra (Patience, Hex) | 38 | 38 (15 on one hit)
  note: What the shape means, one sentence.                    <- optional
  ```
  | Character | Dealt | Taken |                                <- a table; a `---:` column is numeric
  | --- | ---: | ---: |
  A paragraph. **Bold**, *italic*, `code`.
  - a list

Layout rules it applies (the template's rule 9): every h2 sits in a .keep with its first block,
and with the block after it when that is a figure or the first row of a long table; a table over
eight rows keeps its first row with the heading and lets the rest break between rows; the footer
rides in the last .keep.
"""
import html
import os
import re
import sys
from datetime import date

src, out = sys.argv[1:3]
campaign = sys.argv[sys.argv.index("--campaign") + 1] if "--campaign" in sys.argv else "Echoes of Halruaa"
md = open(src, encoding="utf-8").read()
TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".claude", "skills", "session-scribe",
                        "templates", "combat-log.html")


def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*\*(.+?)\*\*\*", r"<strong><em>\1</em></strong>", t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", t)
    return (t.replace(" — ", " &mdash; ").replace("→", "&rarr;").replace("×", "&times;")
            .replace("·", "&middot;"))


def parse(text):
    lines = text.splitlines()
    i, blocks = 0, []
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
        elif line.startswith("```bars"):
            caption, rows, note = line[7:].strip(), [], ""
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                if lines[i].lower().startswith("note:"):
                    note = lines[i][5:].strip()
                elif "|" in lines[i]:
                    cells = [c.strip() for c in lines[i].split("|")]
                    value = float(re.match(r"-?[\d.]+", cells[1]).group())
                    rows.append((cells[0], value, cells[2] if len(cells) > 2 else cells[1]))
                i += 1
            i += 1
            blocks.append(("bars", (caption, rows, note)))
        elif line.startswith("# "):
            blocks.append(("h1", line[2:]))
            i += 1
        elif line.startswith("## "):
            blocks.append(("h2", line[3:]))
            i += 1
        elif line.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(lines[i][1:].strip())
                i += 1
            blocks.append(("callout", " ".join(buf)))
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            blocks.append(("table", (rows[0], rows[1], rows[2:])))
        elif line.startswith("- "):
            items = []
            while i < len(lines) and (lines[i].startswith("- ") or (lines[i].startswith("  ") and lines[i].strip())):
                if lines[i].startswith("- "):
                    items.append(lines[i][2:].strip())
                else:
                    items[-1] += " " + lines[i].strip()
                i += 1
            blocks.append(("ul", items))
        else:
            buf = []
            while i < len(lines) and lines[i].strip() and not re.match(r"(#|\||>|- |```)", lines[i]):
                buf.append(lines[i].strip())
                i += 1
            blocks.append(("p", " ".join(buf)))
    return blocks


def bars(caption, rows, note):
    top = max((v for _, v, _ in rows), default=1) or 1
    body = "".join(
        f'<div class="row"><span class="name">{inline(n)}</span><span class="track"><span class="fill" '
        f'style="width:{round(100 * v / top)}%"></span></span><span class="val">{inline(label)}</span></div>'
        for n, v, label in rows)
    tail = f'\n    <p class="figure-note">{inline(note)}</p>' if note else ""
    return f'<figure>\n    <figcaption>{inline(caption)}</figcaption>\n    <div class="bars">{body}</div>{tail}\n  </figure>'


def widths(head, rows):
    size = [max(len(re.sub(r"[*`]", "", r[k])) for r in rows + [head]) for k in range(len(head))]
    size = [min(max(x, 7), 60) ** 0.75 for x in size]
    return "<colgroup>" + "".join(f'<col style="width:{100 * x / sum(size):.1f}%">' for x in size) + "</colgroup>"


def table(head, align, rows, part=""):
    """part: "" whole · "first" the head and the first row, kept with the heading · "rest" the other rows."""
    num = [a.strip().endswith(":") for a in align]
    cls = [' class="num"' if n else "" for n in num]
    th = "".join(f"<th{cls[k]}>{inline(h)}</th>" for k, h in enumerate(head))
    free = ";break-inside:auto;page-break-inside:auto"
    cg = widths(head, rows) if part else ""
    if part == "first":
        body = "<tr>" + "".join(f'<td{cls[k]} style="border-bottom:1px solid var(--rule)">{inline(c)}</td>'
                                for k, c in enumerate(rows[0])) + "</tr>"
        return (f'<div class="scroll" style="margin-bottom:0"><table class="data" style="table-layout:fixed">{cg}'
                f"<thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div>")
    body = "".join("<tr>" + "".join(f"<td{cls[k]}>{inline(c)}</td>" for k, c in enumerate(r)) + "</tr>"
                   for r in (rows[1:] if part == "rest" else rows))
    if part == "rest":
        return (f'<div class="scroll" style="{free[1:]}"><table class="data" style="table-layout:fixed{free}">{cg}'
                f"<tbody>{body}</tbody></table></div>")
    return f'<div class="scroll"><table class="data"><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div>'


blocks = parse(md)
m = re.match(r"Combat stats — Session (\S+) · (.*?) \((\d{4})-(\d{2})-(\d{2})\)\s*$", blocks[0][1])
if blocks[0][0] != "h1" or not m:
    sys.exit('the first line must read "# Combat stats — Session N · Title (YYYY-MM-DD)"')
session, title = m.group(1), m.group(2)
day = date(int(m.group(3)), int(m.group(4)), int(m.group(5))).strftime("%d %B %Y").lstrip("0")

k, lead = 1, []
while k < len(blocks) and blocks[k][0] != "h2":
    kind, payload = blocks[k]
    if kind == "p":
        lead.append(f'<p class="lead">{inline(payload)}</p>')
    elif kind == "callout":
        lead.append(f'<div class="callout flag">\n    <p>{inline(payload)}</p>\n  </div>')
    k += 1
sections = []
while k < len(blocks):
    heading = blocks[k][1]
    k += 1
    content = []
    while k < len(blocks) and blocks[k][0] != "h2":
        content.append(blocks[k])
        k += 1
    sections.append((heading, content))
combats = sum(1 for h, _ in sections if re.search(r"\brounds?\b", h))
m = re.search(r"\((\d+) stamped of (\d+) messages\)", md)
folded = f" &middot; folded from {m.group(1)} stamped messages of {m.group(2)}" if m else ""

FOOTER = "<footer>\n    Compiled from the combat ledger and the chat rolls by the session scribe.\n  </footer>"
body = ['<section>\n  <div class="keep">\n  ' + "\n  ".join(lead) + "\n  </div>\n</section>"]
for index, (heading, content) in enumerate(sections):
    parts = []
    for kind, payload in content:
        if kind == "p":
            parts.append(f"<p>{inline(payload)}</p>")
        elif kind == "callout":
            parts.append(f'<div class="callout"><p>{inline(payload)}</p></div>')
        elif kind == "bars":
            parts.append(bars(*payload))
        elif kind == "ul":
            parts.append("<ul>" + "".join(f"<li>{inline(x)}</li>" for x in payload) + "</ul>")
        elif kind == "table":
            head, align, rows = payload
            if len(rows) > 8:
                parts += [table(head, align, rows, "first"), table(head, align, rows, "rest")]
            else:
                parts.append(table(head, align, rows))
    keep = 1
    if len(parts) > 1 and parts[0].startswith("<p>") and (
            parts[1].startswith("<figure") or 'style="margin-bottom:0"' in parts[1][:60]):
        keep = 2
    last = index == len(sections) - 1
    if last and len(parts) > keep:  # the footer rides in the document's last .keep
        tail = ("\n  ".join(parts[keep:-1]) + '\n  <div class="keep">\n  ' + parts[-1] + "\n  " + FOOTER + "\n  </div>")
    else:
        tail = "\n  ".join(parts[keep:]) + ("\n  " + FOOTER if last else "")
    body.append('<section>\n  <div class="keep">\n  <h2>' + inline(heading) + "</h2>\n  " + "\n  ".join(parts[:keep])
                + "\n  </div>\n  " + tail + "\n</section>")

template = open(TEMPLATE, encoding="utf-8").read()
style = re.search(r"<style>.*?</style>", template, re.S).group(0)
style = style.replace("{{SESSION_NO}}", session)
page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session {session} — Combat Log · {html.escape(title)}</title>
{style}
</head>

<body>
<div class="wrap">
<div class="sheet">

<header>
  <p class="eyebrow">{html.escape(campaign)} &mdash; Session {session}</p>
  <h1>Combat Log &mdash; {inline(title)}</h1>
  <p class="sub">{day} &middot; {combats} combat{"" if combats == 1 else "s"}{folded}</p>
</header>

{chr(10).join(body)}

</div>
</div>
</body>
</html>
"""
open(out, "w", encoding="utf-8", newline="\n").write(page)
print(f"{out}: session {session}, {combats} combats, {len(sections)} sections, "
      f"{sum(1 for _, c in sections for kind, _ in c if kind == 'bars')} bar figures")
