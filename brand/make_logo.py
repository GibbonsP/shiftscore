"""Generate the Shift Score logo files in brand/ (SVG).  Mark: two interlocking S letters (SS) on a face-off circle.
Run: python3 brand/make_logo.py"""
import os
NAVY, SKY, ICE = "#0a1f3d", "#5db4f0", "#eaf4fc"
R = 10                                                              # radius of each bowl of the S
W, CUT = 4.6, 1.8                                                   # letter stroke, and the gap cut where one passes over the other
def s_arcs(cx, cy=32):
    """An S made of two arcs: the upper bowl (opens to the right) and the lower bowl (opens to the left), meeting at the centre."""
    return (f"M{cx + 8.2:.1f} {cy - 15.7:.1f}A{R} {R} 0 1 0 {cx:.1f} {cy}",
            f"M{cx:.1f} {cy}A{R} {R} 0 1 1 {cx - 8.2:.1f} {cy + 15.7:.1f}")

def ss_arc(bg):
    """Two S letters side by side, 13 apart, so their bowls cross at the top and at the bottom. At the top the left S passes
    over the right one and at the bottom the right passes over the left, which is what interlocks them. Each over-stroke gets a
    flat-ended gap cut in `bg` just before it is drawn, so the crossing reads as a weave. No clipping, so there are no seams."""
    l_up, l_lo = s_arcs(25.5)
    r_up, r_lo = s_arcs(38.5)
    def p(d, colour, width, cap="round"):
        return f'<path d="{d}" fill="none" stroke="{colour}" stroke-width="{width}" stroke-linecap="{cap}"/>'
    return (p(r_up, SKY, W)                                  # right upper bowl, goes under the left one
            + p(l_up, bg, W + CUT * 2, "butt") + p(l_up, ICE, W)      # left upper bowl passes over it
            + p(l_lo, ICE, W)                                # left lower bowl, goes under the right one
            + p(r_lo, bg, W + CUT * 2, "butt") + p(r_lo, SKY, W))     # right lower bowl passes over it


# The bold interlock (the first design): two heavy S letters offset 13 apart. The left S passes over the right one in the upper
# half and the right over the left in the lower half; a gap cut in the background colour sits beside each over-stroke. Each S is
# split at its middle into an upper and a lower piece, and the over / under is done by drawing order, so there are no seams.
def _split(seg, t=0.5):
    p0, p1, p2, p3 = seg
    mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    a, b, c = mid(p0, p1), mid(p1, p2), mid(p2, p3)
    d, e = mid(a, b), mid(b, c)
    f = mid(d, e)
    return (p0, a, d, f), (f, e, c, p3)

_SEGS = [((43, 24.5), (43, 17), (21, 17), (21, 27)), ((21, 27), (21, 36.5), (43, 29.5), (43, 39.5)), ((43, 39.5), (43, 48), (21, 48), (21, 40.5))]
def _d(segs, dx):
    pt = lambda q: f"{q[0] + dx:.2f} {q[1]:.2f}"
    out = f"M{pt(segs[0][0])}"
    for _, c1, c2, e in segs:
        out += f"C{pt(c1)} {pt(c2)} {pt(e)}"
    return out

def s_bold_pieces(dx):
    first, second = _split(_SEGS[1])
    return _d([_SEGS[0], first], dx), _d([second, _SEGS[2]], dx)       # upper piece, lower piece

def ss(bg, W=5.6, CUT=3.2, OFF=8.0):          # OFF: how far each S sits from the centre line (6.5 is the tightest, first version)
    l_up, l_lo = s_bold_pieces(-OFF)
    r_up, r_lo = s_bold_pieces(OFF)
    def p(d, colour, width, cap="round"):
        return f'<path d="{d}" fill="none" stroke="{colour}" stroke-width="{width}" stroke-linecap="{cap}" stroke-linejoin="round"/>'
    return (p(r_up, SKY, W)
            + p(l_up, bg, W + CUT * 2, "butt") + p(l_up, ICE, W)       # upper half: the left S passes over the right
            + p(l_lo, ICE, W)
            + p(r_lo, bg, W + CUT * 2, "butt") + p(r_lo, SKY, W))      # lower half: the right S passes over the left

def mark(bg_square=True, arc=False):
    bg = NAVY
    sq = f'<rect width="64" height="64" rx="14" fill="{NAVY}"/>' if bg_square else ''
    ring = f'<circle cx="32" cy="32" r="28" fill="none" stroke="{SKY}" stroke-width="2.2" opacity="0.45"/>' if bg_square else ''
    return f'{sq}{ring}{ss_arc(bg) if arc else ss(bg)}'

def svg(inner, vb="0 0 64 64"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="Shift Score">{inner}</svg>\n'

def lockup(shift_fill):
    return svg(f'<g transform="translate(16 16) scale(1.5)">{mark(True)}</g>'
               f'<text x="130" y="94" font-family="\'Big Shoulders Display\',\'Arial Narrow\',Impact,sans-serif" font-weight="900" font-size="88" letter-spacing="1.5">'
               f'<tspan fill="{shift_fill}">SHIFT</tspan><tspan fill="{SKY}">SCORE</tspan></text>', "0 0 640 128")

here = os.path.dirname(os.path.abspath(__file__))
def w(name, text):
    open(os.path.join(here, name), "w").write(text)
w("logo-mark.svg", svg(mark(True)))
w("favicon.svg", svg(mark(True)))
w("logo-mark-bare.svg", svg(mark(False)))
w("alt-arc-mark.svg", svg(mark(True, arc=True)))   # the lighter arc-built version, kept as an alternate        # no background square, for use on navy
w("logo-lockup-dark.svg", lockup(ICE))           # for dark / navy backgrounds
w("logo-lockup-light.svg", lockup(NAVY))         # for light backgrounds
w("og-image.svg", svg(
    f'<rect width="1200" height="630" fill="{NAVY}"/><circle cx="1010" cy="120" r="260" fill="none" stroke="{SKY}" stroke-width="3" opacity="0.18"/>'
    f'<g transform="translate(80 150) scale(3)">{mark(True)}</g>'
    f'<text x="320" y="285" font-family="\'Big Shoulders Display\',\'Arial Narrow\',Impact,sans-serif" font-weight="900" font-size="180" letter-spacing="2"><tspan fill="{ICE}">SHIFT</tspan><tspan fill="{SKY}">SCORE</tspan></text>'
    f'<text x="84" y="450" font-family="Barlow,\'Helvetica Neue\',Arial,sans-serif" font-size="40" fill="{ICE}" opacity="0.9">Every NHL game scored player by player.</text>'
    f'<text x="84" y="505" font-family="Barlow,\'Helvetica Neue\',Arial,sans-serif" font-size="32" fill="{SKY}">Game Score, shot quality, lines, pairs and special teams.</text>', "0 0 1200 630"))
print("wrote brand/*.svg")
