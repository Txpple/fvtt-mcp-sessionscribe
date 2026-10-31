"""Convert a session's recap.html (the email layout) into Session Diary journal HTML.

The diary page is the recap itself, not a summary (DM, 2026-10-30): every section, illustration,
song, quote, deed and lore entry, with one illustration moved to the top as the title picture.

usage: python scripts/recap-to-journal.py <recap.html> <asset-prefix> <title-image> <out.html>

  <asset-prefix>  Data-relative folder the session's img/ was uploaded to, ending in "/",
                  e.g. worlds/<world>/assets/journal/session-diary/2026-10-27/
  <title-image>   a file name from img/, e.g. 01-the-door-opens.jpg

Mapping: header -> date line; the TL;DR -> p.lead; h2 -> h2.spaced; picture tables -> figure with
figcaption; party cards (00-*.jpg) -> a floated portrait beside the text; the shaded song box and
lore blockquotes -> blockquote.readaloud. Inline styles, tables and spans are dropped.
"""
import re
import sys
from html.parser import HTMLParser

src, prefix, title_img, out = sys.argv[1:5]
s = open(src, encoding="utf-8").read()

# The header row of the outer table holds the kicker, the h1 and the date.
head_end = s.index("</tr>")
date = re.sub(r"\s+", " ", re.findall(r"<p[^>]*>(.*?)</p>", s[:head_end], re.S)[-1]).strip()
body = s[head_end:]

# The TL;DR is the first italic body paragraph of real length (session 0 opens with a short
# italic tagline above it).
for m in re.finditer(r'<p style="([^"]*font-size:15px[^"]*font-style:italic[^"]*)">(.*?)</p>', body, re.S):
    if len(re.sub(r"<[^>]+>|\s+", " ", m.group(2))) > 200:
        body = body[:m.start()] + '<p data-lead="1">' + body[m.start(2):]
        break

KEEP = {"p", "em", "strong", "ul", "ol", "li", "br", "b", "i", "h3", "h4"}
FIGCAPTION = '<figcaption style="text-align:center;font-size:0.9em;opacity:0.75">'


class Conv(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.out = []
        self.tables = []  # kinds: plain / figure / card / box
        self.p_stack = []
        self.caption_next = False
        self.in_caption = False
        self.skip = 0  # inside the title figure, which moves to the top
        self.title_caption = []
        self.title_alt = ""

    def emit(self, x):
        if self.skip:
            if self.in_caption:
                self.title_caption.append(x)
            return
        self.out.append(x)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        style = a.get("style") or ""
        if tag == "table":
            kind = "box" if "#f2ead9" in style else "plain"
            self.tables.append(kind)
            if kind == "box":
                self.emit('<blockquote class="readaloud">')
            return
        if tag == "img":
            f = a["src"].split("/")[-1]
            alt = a.get("alt", "")
            if f.startswith("00-"):
                self.tables[-1] = "card"
                self.emit(f'<div style="overflow:hidden;margin:0 0 0.75em"><img src="{prefix}{f}" alt="{alt}" '
                          'style="float:left;width:96px;margin:0 12px 6px 0;border-radius:4px">')
            else:
                self.tables[-1] = "figure"
                if f == title_img:
                    self.skip += 1
                    self.title_alt = alt
                self.emit(f'<figure style="margin:0 0 0.75em"><img src="{prefix}{f}" alt="{alt}" '
                          'style="max-width:100%;border-radius:4px">')
                self.caption_next = True
            return
        if tag in ("tr", "td", "div", "span", "a"):
            return
        if tag == "h2":
            self.emit('<h2 class="spaced">')
            return
        if tag == "blockquote":
            self.emit('<blockquote class="readaloud">')
            return
        if tag == "p":
            if self.caption_next:
                self.caption_next = False
                self.in_caption = True
                self.p_stack.append("figcaption")
                self.emit(FIGCAPTION)
                return
            prev = [x for x in self.out if x.strip()][-1:] or [""]
            if "letter-spacing" in style or (self.tables[-1:] == ["card"] and prev[0].startswith("<div")):
                self.p_stack.append("h3")
                self.emit("<h3>")
                return
            self.p_stack.append("p")
            self.emit('<p class="lead">' if a.get("data-lead") else "<p>")
            return
        if tag in KEEP:
            self.emit(f"<{tag}>")

    def handle_endtag(self, tag):
        if tag == "table":
            if not self.tables:  # the outer layout table, opened in the header
                return
            kind = self.tables.pop()
            if kind == "box":
                self.emit("</blockquote>")
            elif kind == "card":
                self.emit("</div>")
            elif kind == "figure":
                self.emit("</figure>")
                if self.skip:
                    self.skip -= 1
            return
        if tag in ("tr", "td", "div", "span", "a", "img"):
            return
        if tag in ("h2", "blockquote"):
            self.emit(f"</{tag}>")
            return
        if tag == "p":
            kind = self.p_stack.pop() if self.p_stack else "p"
            if kind == "figcaption":
                self.in_caption = False
            self.emit(f"</{kind}>")
            return
        if tag in KEEP:
            self.emit(f"</{tag}>")

    def handle_data(self, d):
        d = re.sub(r"\s+", " ", d)
        last = self.out[-1] if self.out else ""
        if last.startswith("<") and last.endswith(">") and not last.startswith("</"):
            d = d.lstrip()
        self.emit(d)

    def handle_entityref(self, n):
        self.emit(f"&{n};")

    def handle_charref(self, n):
        self.emit(f"&#{n};")


c = Conv()
c.feed(body)
html = "".join(c.out)
html = re.sub(r"\s+(</(p|h2|h3|li|figcaption|em|strong)>)", r"\1", html)
# Collapse whitespace around block tags only; a space between two inline tags is text.
html = re.sub(r"(</?(?:p|h[1-6]|ul|ol|li|figure|figcaption|blockquote|div)\b[^>]*>)\s+(?=<)", r"\1", html)
html = re.sub(r">\s+(?=</?(?:p|h[1-6]|ul|ol|li|figure|figcaption|blockquote|div|img)\b)", ">", html)
html = re.sub(r"<p>\s*</p>", "", html)

cap = re.sub(r"</?figcaption[^>]*>", "", "".join(c.title_caption)).strip()
top = (f'<figure style="margin:0 0 0.75em"><img src="{prefix}{title_img}" alt="{c.title_alt}" '
       'style="max-width:100%;border-radius:4px">'
       + (f"{FIGCAPTION}{cap}</figcaption>" if cap else "")
       + "</figure>")
html = top + f"<p><em>{date}</em></p>" + html.strip()
open(out, "w", encoding="utf-8").write(html)
print(f"{out}: {len(html)} chars; title picture {title_img}")
