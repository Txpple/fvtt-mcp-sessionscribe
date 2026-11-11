"""Dress a converted journal page as the printed record: a parchment sheet, Georgia, rust headings.

A Foundry journal page has no stylesheet of its own, so everything is an inline style: the look
is the recap PDF's (templates/recap-print.html) and the combat log's (templates/combat-log.html).
Used by recap-to-journal.py and combat-log-to-journal.py; `--plain` on either skips it.

dress(html, kicker, title) -> html
  html    the converter's output, opening with its date line `<p><em>…</em></p>` (after the
          title figure, when there is one)
  kicker  the small line over the title, e.g. "Echoes of Halruaa — Session 4"
  title   the page's title, e.g. "The Spring Feast"
"""
import re

SERIF = "font-family:Georgia,'Times New Roman',serif"
INK, INK2, MUTED, HEAD = "#3d3225", "#4a3f30", "#8a7a5c", "#6b5535"
RULE, EDGE, BAND, SOFT, ACCENT = "#e2d9c8", "#d8cfc0", "#b3a284", "#f2ead9", "#9c5442"

SHEET = (f"max-width:780px;margin:0 auto;padding:26px 34px 22px;background:#fffdf8;border:1px solid {EDGE};"
         f"border-radius:8px;{SERIF};font-size:16px;line-height:1.65;color:{INK2};text-shadow:none")
P = f"margin:0 0 12px;{SERIF};font-size:16px;line-height:1.65;color:{INK2}"
H2 = (f"margin:24px 0 9px;padding:0 0 4px;border:none;border-bottom:1px solid {RULE};{SERIF};font-size:21px;"
      f"font-weight:normal;letter-spacing:.2px;color:{HEAD};text-shadow:none")
H3 = f"margin:16px 0 6px;border:none;{SERIF};font-size:16px;font-weight:bold;color:{HEAD};text-shadow:none"
QUOTE = (f"margin:2px 0 14px;padding:8px 14px;border:none;border-left:3px solid {EDGE};background:#faf6ec;"
         f"{SERIF};font-style:italic;color:#5d4e38;box-shadow:none")
CALLOUT = (f"margin:2px 0 16px;padding:12px 16px;border:none;border-left:4px solid {BAND};border-radius:4px;"
           f"background:{SOFT};{SERIF};font-style:normal;color:#5d4e38;box-shadow:none")
TABLE = f"width:100%;margin:0 0 16px;border-collapse:collapse;border:none;background:none;{SERIF};font-size:14.5px;color:{INK2}"
TH = (f"text-align:left;padding:7px 10px 6px;border:none;border-bottom:2px solid {BAND};background:{SOFT};text-shadow:none;"
      f"font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:{HEAD};white-space:nowrap")
TD = f"padding:7px 10px;border:none;border-bottom:1px solid {RULE};background:none;vertical-align:top;line-height:1.5"
NUM = re.compile(r"^(?:[\d.,]+(?:\s*(?:s|%))?|&mdash;|—|-)$")


def _cells(row):
    return re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)


def _text(x):
    return re.sub(r"<[^>]+>", "", x).strip()


def _bars(table):
    """A two-column table with no head, every value opening on a number: the report's bar figure."""
    if "<thead" in table:
        return None
    rows = [_cells(r) for r in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S)]
    if not rows or any(len(r) != 2 for r in rows):
        return None
    vals = []
    for _, v in rows:
        m = re.match(r"[\d.]+", _text(v))
        if not m:
            return None
        vals.append(float(m.group()))
    top = max(vals) or 1
    out = [f'<table style="{TABLE};margin:0 0 8px"><tbody>']
    for (name, v), n in zip(rows, vals):
        w = round(100 * n / top)
        bar = (f'<div style="height:14px;background:{SOFT};border-radius:3px;overflow:hidden">'
               f'<div style="width:{w}%;height:14px;background:{ACCENT};border-radius:0 4px 4px 0"></div></div>')
        cell = "padding:3px 10px 3px 0;border:none;background:none;vertical-align:middle"
        out.append(f'<tr style="background:none"><td style="{cell};white-space:nowrap;width:1%">{name}</td>'
                   f'<td style="{cell};width:60%">{bar}</td>'
                   f'<td style="{cell};padding-right:0;white-space:nowrap;width:1%">{v}</td></tr>')
    out.append("</tbody></table>")
    return "".join(out)


def _table(m):
    table = m.group(0)
    bars = _bars(table)
    if bars:
        return bars
    table = re.sub(r"<table[^>]*>", f'<table style="{TABLE}">', table)
    # Foundry paints a journal table's head dark: say the head's own colours on every level of it
    table = table.replace("<thead>", f'<thead style="background:{SOFT};color:{HEAD};border:none;text-shadow:none">')
    table = re.sub(r"<tr[^>]*>", '<tr style="background:none">', table)
    table = re.sub(r'(<thead [^>]*>\s*)<tr style="background:none">',
                   lambda m: m.group(1) + f'<tr style="background:{SOFT};color:{HEAD}">', table)
    table = re.sub(r"<th(?=[\s>])[^>]*>", f'<th style="{TH}">', table)

    def cell(c):
        right = ";text-align:right;white-space:nowrap" if NUM.match(_text(c.group(1))) else ""
        return f'<td style="{TD}{right}">{c.group(1)}</td>'
    table = re.sub(r"<td[^>]*>(.*?)</td>", cell, table, flags=re.S)
    # the head of a numeric column lines up with its numbers
    heads = re.findall(r"<th\s[^>]*>.*?</th>", table, re.S)
    first = re.search(r"<tbody>\s*<tr[^>]*>(.*?)</tr>", table, re.S)
    if heads and first:
        tds = re.findall(r"<td [^>]*>", first.group(1))
        for h, td in zip(heads, tds):
            if "text-align:right" in td:
                table = table.replace(h, h.replace("text-align:left", "text-align:right"), 1)
    return table


def _quote(m):
    inner = m.group(1)
    style = CALLOUT if re.match(r"\s*(<p[^>]*>)?\s*<strong", inner) else QUOTE
    inner = re.sub(r"<p[^>]*>", '<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:inherit">', inner)
    head, sep, tail = inner.rpartition("margin:0 0 8px")  # the last paragraph sits flush
    inner = head + "margin:0" + tail if sep else inner
    return f'<blockquote style="{style}">{inner}</blockquote>'


def dress(html, kicker, title):
    # the date line becomes the sheet's header: kicker, title, date, a double rule
    m = re.search(r"<p><em>(.*?)</em></p>", html, re.S)
    head = (f'<div style="margin:0 0 16px;padding:0 0 12px;border-bottom:3px double {BAND}">'
            f'<p style="margin:0;{SERIF};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:{MUTED}">{kicker}</p>'
            f'<p style="margin:5px 0 3px;{SERIF};font-size:30px;line-height:1.15;color:{INK}">{title}</p>'
            f'<p style="margin:0;{SERIF};font-size:13.5px;color:{MUTED}">{m.group(1)}</p></div>')
    html = html[:m.start()] + head + html[m.end():]

    # the printed report splits a long table after its first row so the page can break; here it is one table
    html = html.replace("</tbody></table><table><tbody>", "")
    html = re.sub(r"<table>.*?</table>", _table, html, flags=re.S)
    html = re.sub(r'<blockquote[^>]*>(.*?)</blockquote>', _quote, html, flags=re.S)
    html = re.sub(r'<p class="lead">', f'<p style="{P};font-style:italic;font-size:16.5px;margin-bottom:16px">', html)
    html = html.replace("<p>", f'<p style="{P}">')
    html = re.sub(r"<h2[^>]*>", f'<h2 style="{H2}">', html)
    html = html.replace("<h3>", f'<h3 style="{H3}">')
    html = html.replace("<ul>", f'<ul style="margin:0 0 14px;padding-left:22px;{SERIF};font-size:16px;line-height:1.65;color:{INK2}">')
    html = html.replace("<li>", '<li style="margin:0 0 6px">')
    html = html.replace("<strong>", f'<strong style="color:{INK}">')
    html = re.sub(r'<figure style="[^"]*">', '<figure style="margin:6px 0 16px">', html)
    html = re.sub(r'(<img [^>]*?)style="max-width:100%;border-radius:4px"',
                  rf'\1style="display:block;max-width:100%;height:auto;margin:0 auto;border:1px solid {EDGE};border-radius:4px"', html)
    html = re.sub(r'<figcaption style="[^"]*">',
                  f'<figcaption style="margin-top:5px;{SERIF};font-size:13.5px;font-style:italic;line-height:1.45;color:{MUTED};text-align:left">', html)
    return f'<div class="parchment-sheet" style="{SHEET}">{html}</div>'
