"""Convert a session's combat-log.html (the printed report) into Combat Logs journal HTML.

The journal page is the report itself, every section and table, in the Session Diary's dress:
a date line, h2.spaced sections, the callouts as readaloud blocks. The bar figures, which the
journal cannot draw (no stylesheet), become two-column tables under the figure's caption. The
report's own provenance line ("Source: analyze-combat ...") is the scribe's, not the players',
and is dropped.

usage: python scripts/combat-log-to-journal.py <combat-log.html> <out.html> [--plain] [--title-image <src>]

  --title-image  the Data-relative path of the session's title picture (the Session Diary page's own),
                 set on top so the page has a picture on its card (DM, 2026-11-11)

Mapping: header -> date line (played, n combats); p.lead -> p.lead minus the Source sentence;
div.callout -> blockquote.readaloud; h2 "N · Title" -> h2.spaced "Title"; figure of bars ->
h3 caption + table (name, value) + the figure note; table.data -> a plain table; code -> em.
Classes, inline styles, sections and wrapper divs are dropped.
Then the page is dressed as the printed report (journal_parchment.py: a parchment sheet, the bar
figures drawn as bars again); `--plain` as a third argument skips that.
"""
import re
import sys
from html.parser import HTMLParser

src, out = sys.argv[1:3]
plain = "--plain" in sys.argv[3:]
title_image = sys.argv[sys.argv.index("--title-image") + 1] if "--title-image" in sys.argv else ""
s = open(src, encoding="utf-8").read()

header = re.search(r"<header>(.*?)</header>", s, re.S).group(1)
sub = re.search(r'<p class="sub">(.*?)</p>', header, re.S).group(1)
# "Played 27 October 2026 · 2 combats · folded from ..." -> the first two parts.
parts = [p.strip() for p in sub.split("&middot;")[:2]]
parts[0] = re.sub(r"^Played ", "", parts[0])
iso = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", parts[0])
if iso:  # an older report wrote the ISO date
    from datetime import date
    parts[0] = date(*map(int, iso.groups())).strftime("%d %B %Y").lstrip("0")
date_line = " &middot; ".join(parts)
body = s[s.index("</header>") + len("</header>"):]

KEEP = {"p", "em", "strong", "ul", "ol", "li", "br", "b", "i", "h3", "h4",
        "table", "thead", "tbody", "tr", "th", "td"}


class Conv(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.out = []
        self.in_bars = False      # inside <div class="bars">: rows become table rows
        self.bar_cell = None      # "name" | "val" | None while in a bars row
        self.in_caption = False   # figcaption -> h3
        self.in_lead = False
        self.lead_buf = []
        self.in_h2 = False
        self.h2_buf = []
        self.skip_depth = 0       # spans of the bars that draw (track / fill)
        self.in_note = False      # p.figure-note -> p > em

    def emit(self, x):
        if self.skip_depth:
            return
        if self.in_lead:
            self.lead_buf.append(x)
        elif self.in_h2:
            self.h2_buf.append(x)
        else:
            self.out.append(x)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get("class") or "").split()
        if self.skip_depth:
            self.skip_depth += 1
            return
        if tag == "div" and "callout" in cls:
            self.emit('<blockquote class="readaloud">')
            return
        if tag == "div" and "bars" in cls:
            self.in_bars = True
            self.emit("<table><tbody>")
            return
        if self.in_bars and tag == "span":
            if "name" in cls or "val" in cls:
                self.bar_cell = "name" if "name" in cls else "val"
                self.emit("<td>")
                return
            if "track" in cls or "fill" in cls:
                self.skip_depth = 1
                return
        if self.in_bars and tag == "div" and "row" in cls:
            self.emit("<tr>")
            return
        if tag == "figcaption":
            self.in_caption = True
            self.emit("<h3>")
            return
        if tag == "p" and "lead" in cls:
            self.in_lead = True
            self.lead_buf = []
            return
        if tag == "p" and "figure-note" in cls:
            self.in_note = True
            self.emit("<p><em>")
            return
        if tag == "h2":
            self.in_h2 = True
            self.h2_buf = []
            return
        if tag == "footer":
            self.skip_depth = 1
            return
        if tag == "code":
            self.emit("<em>")
            return
        if tag in KEEP:
            self.emit(f"<{tag}>")

    def handle_endtag(self, tag):
        if self.skip_depth:
            self.skip_depth -= 1
            return
        if tag == "div":
            # the callout, a bars row, the bars block, or a wrapper: tell by what is open
            last = self.out[-1] if self.out else ""
            if self.in_bars:
                if self.bar_cell is None and last == "</td>":
                    self.emit("</tr>")
                    return
                if last == "</tr>":
                    self.in_bars = False
                    self.emit("</tbody></table>")
                    return
            if self.open_callout():
                self.emit("</blockquote>")
            return
        if tag == "span" and self.bar_cell:
            self.bar_cell = None
            self.emit("</td>")
            return
        if tag == "figcaption":
            self.in_caption = False
            self.emit("</h3>")
            return
        if tag == "p" and self.in_lead:
            self.in_lead = False
            lead = "".join(self.lead_buf).strip()
            # drop the sentence(s) carrying the scribe's provenance (they hold <code>)
            parts = re.split(r"(?<=[.!?])\s+", lead)
            parts = [p for p in parts if "<em>analyze-combat</em>" not in p and "<em>transcript.md</em>" not in p]
            lead = " ".join(parts)
            self.out.append(f'<p class="lead">{lead}</p>')
            return
        if tag == "p" and self.in_note:
            self.in_note = False
            self.emit("</em></p>")
            return
        if tag == "h2":
            self.in_h2 = False
            title = "".join(self.h2_buf).strip()
            title = re.sub(r"^\d+\s*&middot;\s*", "", title)
            self.out.append(f'<h2 class="spaced">{title}</h2>')
            return
        if tag == "code":
            self.emit("</em>")
            return
        if tag in KEEP:
            self.emit(f"</{tag}>")

    def open_callout(self):
        depth = 0
        for x in reversed(self.out):
            if x == "</blockquote>":
                depth += 1
            elif x == '<blockquote class="readaloud">':
                if depth == 0:
                    return True
                depth -= 1
        return False

    def handle_data(self, d):
        if d.strip() or self.in_lead or self.in_h2 or self.bar_cell or self.in_caption:
            self.emit(d)

    def handle_entityref(self, name):
        self.emit(f"&{name};")

    def handle_charref(self, name):
        self.emit(f"&#{name};")


c = Conv()
c.feed(body)
html = "".join(c.out)
html = re.sub(r"\s+", " ", html)
html = re.sub(r">\s+<", "><", html)
html = f"<p><em>{date_line}</em></p>" + html.strip()
tables = html.count("<table>")
if title_image:
    html = (f'<figure style="margin:0 0 0.75em"><img src="{title_image}" alt="" '
            'style="max-width:100%;border-radius:4px"></figure>') + html
if not plain:
    from journal_parchment import dress
    kicker = re.search(r'<p class="eyebrow">(.*?)</p>', header, re.S).group(1).strip()
    title = re.sub(r"\s+", " ", re.search(r"<h1>(.*?)</h1>", header, re.S).group(1)).strip()
    html = dress(html, kicker, title)
open(out, "w", encoding="utf-8").write(html)
print(f"{out}: {len(html)} chars, {tables} tables, {html.count('<h2')} sections, {html.count('<blockquote')} callouts")
