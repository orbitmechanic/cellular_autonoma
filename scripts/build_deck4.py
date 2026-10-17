#!/usr/bin/env python3
import json, uno
from com.sun.star.beans import PropertyValue

STUDY = json.load(open("/home/orbit9/Work/cellular_autonoma/fat-study.json"))

def pv(n, v):
    p = PropertyValue(); p.Name = n; p.Value = v; return p

local = uno.getComponentContext()
resolver = local.ServiceManager.createInstanceWithContext(
    "com.sun.star.bridge.UnoUrlResolver", local)
ctx = resolver.resolve("uno:socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext")
smgr = ctx.ServiceManager
desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
doc = desktop.loadComponentFromURL("private:factory/simpress", "_blank", 0, (pv("Hidden", True),))

W, H = 28000, 15750
DARK = 0x14203A
ACCENT = 0x2E86AB
GREEN = 0x2E8B57
RED = 0xC0392B
GOLD = 0xB8860B
PURPLE = 0x8E44AD
WHITE = 0xFFFFFF
GREY = 0x667080

def add_slide():
    doc.DrawPages.insertNewByIndex(doc.DrawPages.Count)
    pg = doc.DrawPages.getByIndex(doc.DrawPages.Count - 1)
    pg.Width = W; pg.Height = H
    return pg

def bg(pg, color=DARK):
    r = doc.createInstance("com.sun.star.drawing.RectangleShape")
    s = uno.createUnoStruct("com.sun.star.awt.Size"); s.Width = W; s.Height = H
    p = uno.createUnoStruct("com.sun.star.awt.Point"); p.X = 0; p.Y = 0
    r.Size = s; r.Position = p
    r.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle", "SOLID"); r.FillColor = color
    r.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle", "NONE")
    pg.add(r)

def box(x, y, w, h):
    s = uno.createUnoStruct("com.sun.star.awt.Size"); s.Width = w; s.Height = h
    p = uno.createUnoStruct("com.sun.star.awt.Point"); p.X = x; p.Y = y
    return (s, p)

def txt(pg, x, y, w, h, lines, size=18, color=WHITE, bold=False, mono=False, align="LEFT", space=6):
    sh = doc.createInstance("com.sun.star.drawing.TextShape")
    sz, pt = box(x, y, w, h)
    sh.Size = sz; sh.Position = pt
    sh.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle", "NONE")
    sh.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle", "NONE")
    pg.add(sh)
    cur = sh.Text.createTextCursor()
    if isinstance(lines, str):
        lines = [lines]
    for i, line in enumerate(lines):
        if i > 0:
            sh.Text.insertControlCharacter(cur, 0, False)
        cur.setPropertyValue("CharHeight", size)
        cur.setPropertyValue("CharWeight", 100 if bold else 0)
        cur.setPropertyValue("CharColor", color)
        cur.setPropertyValue("CharFontName", "DejaVu Sans Mono" if mono else "DejaVu Sans")
        cur.setPropertyValue("ParaAdjust", uno.Enum("com.sun.star.style.ParagraphAdjust", align))
        cur.setPropertyValue("ParaBottomMargin", space)
        sh.Text.insertString(cur, line, False)
    return sh

def row(pg, y, h, color=0x1E2C47, line=None, x=1400, w=25300):
    r = doc.createInstance("com.sun.star.drawing.RectangleShape")
    sz, pt = box(x, y, w, h)
    r.Size = sz; r.Position = pt
    r.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle", "SOLID"); r.FillColor = color
    if line:
        r.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle", "SOLID"); r.LineColor = line; r.LineWidth = 60
    else:
        r.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle", "NONE")
    pg.add(r)

def bullets(lines):
    out = []
    for lvl, text in lines:
        pre = "" if lvl == 0 else "      "
        mark = "-  " if lvl == 0 else ".  "
        out.append(pre + mark + text)
    return out


# ---- v2.3 slides ----

def s_title():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 3600, 25000, 2600, ["CELULAR AUTONOMA  v2.3"], size=50, color=WHITE, bold=True)
    txt(pg, 1550, 6400, 25000, 1400, ["Fat cells & ecosystem services - storing gas, renting bytes, serving giants"], size=20, color=ACCENT)
    txt(pg, 1550, 8200, 25000, 2000, [
        "The user's intuition: hoard cheap gas in expensive contracts,",
        "spend it when gas is dear. Meet the 2026 EVM that said 'yes, but'.",
    ], size=16, color=GREY, space=3)
    txt(pg, 1550, 13600, 25000, 800, ["85 tests passing  -  issues #29-#30  -  PR #31 (stacked on #28)  -  measured, not modeled"], size=14, color=GREEN)

def s_physics():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["The idea vs the physics (2021 -> 2026)"], size=32, color=ACCENT, bold=True)
    txt(pg, 1500, 2300, 12500, 1000, ["What you proposed (worked pre-2023):"], size=17, color=GREEN, bold=True)
    txt(pg, 1500, 3200, 12500, 8000, bullets([
        (0, "Deploy fat contracts when gas cheap (24k refund reserved)"),
        (0, "SELFDESTRUCT when dear: 24,000 gas back per contract"),
        (0, "Cap: refunds up to 1/2 of a tx - gas tokens (GST2) were a real market"),
    ]), size=15.5, space=8)
    txt(pg, 14800, 2300, 12500, 1000, ["What the chain decided:"], size=17, color=RED, bold=True)
    txt(pg, 14800, 3200, 12700, 8600, bullets([
        (0, "EIP-3529: selfdestruct refund DELETED. Clear refund 15k -> 4,800. Refunds capped at 1/5 of tx gas."),
        (0, "EIP-6780: selfdestruct stops deleting the contract at all."),
        (0, "EIP-3298 (scheduled): removes even the last clearing refund - gas tokens stay dead, permanently."),
    ]), size=15.5, space=8)
    txt(pg, 1500, 13300, 25500, 1200, ["Verdict: the mechanism is a WASTING ASSET with an expiry date - so the organ is built to profit even after it dies."], size=16, color=GOLD, bold=True)

def s_design():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["The Adipocyte - what survived, engineered"], size=32, color=ACCENT, bold=True)
    cards = [
        ("INFLATE", "basefee <= ceiling", "write non-zero slots: 22,100 gas each, auto-run by the expression cycle when gas is cheap. The cell buys 4,800-gas options at a discount.", "0x4ECDC4"),
        ("RENDER", "basefee >= floor", "clear slots: 4,800 refund each, capped at 1/5 of the tx. Permissionless - ANY keeper bundles it into their real work and pays less.", GOLD),
        ("PARK", "the business", "tenants PAY rent to hold 32 bytes in an autonomous archive. Rent -> the cell's food. The bytes -> the blubber. EIP-3298 can't kill the rent.", GREEN),
    ]
    x = 1500
    for name, sub, text, col in cards:
        c = col if isinstance(col, int) else int(col.replace("0x",""), 16)
        row(pg, 2300, 9800, 0x1E2C47, line=c, x=x, w=8300)
        txt(pg, x + 250, 2550, 7800, 1200, [name], size=24, color=c, bold=True)
        txt(pg, x + 250, 3800, 7800, 800, [sub], size=13, color=GREY, mono=True)
        txt(pg, x + 250, 4800, 7800, 6800, [text], size=14, color=WHITE)
        x += 8700
    txt(pg, 1500, 12600, 25500, 1600, [
        "The refund accrues to the TRANSACTION SENDER - not the contract. The organism therefore spends its fat exactly where the brief always needed it:",
        "subsidizing the keepers who run its metabolism, precisely when metabolism is dear. Biological triage of attention, implemented as an option.",
    ], size=15, color=GOLD, space=4)

def s_measured():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Measured on-chain (fat-study.js)"], size=32, color=ACCENT, bold=True)
    txt(pg, 1500, 2200, 25500, 1000, ["64-slot render @10 gwei: billed %s vs executed %s - the exact EIP-3529 4/5 billing signature" % ("{:,}".format(STUDY["render_billed_gas"]), "{:,}".format(STUDY["render_executed_est"]))], size=15, color=WHITE)
    rows = STUDY["arbitrage_table"]
    y = 3600
    txt(pg, 1500, y-400, 25000, 800, ["Fatten cheap -> render dear: ETH recovery as a share of fatten cost (64 slots, replicate-scale host tx)"], size=15, color=GREY)
    r = doc.createInstance("com.sun.star.drawing.RectangleShape")
    sz, pt = box(1400, y-500, 25300, 850); sz and None
    r.Size = sz; r.Position = pt; r.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle","SOLID")
    r.FillColor = ACCENT; r.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle","NONE"); pg.add(r)
    txt(pg, 1600, y-400, 9000, 700, ["cheap -> dear (gwei)"], size=15, color=DARK, bold=True)
    txt(pg, 11000, y-400, 5000, 700, ["spent"], size=15, color=DARK, bold=True, align="RIGHT")
    txt(pg, 16500, y-400, 5000, 700, ["rebate"], size=15, color=DARK, bold=True, align="RIGHT")
    txt(pg, 22000, y-400, 4500, 700, ["recovery"], size=15, color=DARK, bold=True, align="RIGHT")
    y += 950
    for row_ in rows:
        rr = doc.createInstance("com.sun.star.drawing.RectangleShape")
        sz, pt = box(1400, y, 25300, 850); sz and None
        rr.Size = sz; rr.Position = pt; rr.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle","SOLID")
        rr.FillColor = 0x1E2C47 if (y//950)%2==0 else 0x22324F
        rr.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle","NONE"); pg.add(rr)
        label = "%s -> %s" % (row_["cheapGwei"], row_["dearGwei"])
        txt(pg, 1600, y+80, 9000, 700, [label], size=14, color=WHITE, mono=True)
        txt(pg, 11000, y+80, 5000, 700, ["%.5f" % row_["spentEth"]], size=14, color=GREY, mono=True, align="RIGHT")
        txt(pg, 16500, y+80, 5000, 700, ["%.5f" % row_["rebateEth"]], size=14, color=WHITE, mono=True, align="RIGHT")
        col = GREEN if row_["pct"] >= 100 else (GOLD if row_["pct"] >= 60 else RED)
        txt(pg, 22000, y+80, 4500, 700, ["%s%%" % row_["pct"]], size=14, color=col, bold=True, align="RIGHT")
        y += 950
    txt(pg, 1500, y+300, 25500, 1600, [
        "Breakeven ~6.4x price ratio. L1 off-peak -> congestion works; flat-fee L2s correctly see the organ idle.",
        "The refund is a 20% toll on every big transaction's gas bill while the mechanism lives - priced as a decaying option, banked by rent.",
    ], size=14, color=GREY, space=4)

def s_landscape():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["What the giants run on (2026 survey)"], size=32, color=ACCENT, bold=True)
    rows = [
        ("Uniswap v4", "$338B volume, 23k HOOKS - third-party extension contracts; Uniswap shipped a hook SECURITY FRAMEWORK because hooks keep breaking"),
        ("Aave / Compound", "money markets running on liquidators, keepers and credit delegates - work done by OTHER people's bots"),
        ("Chainlink / Gelato / Keep3r", "the keeper economy: an entire market paying strangers to trigger contracts"),
        ("ENS / ERC-8004", "identity + agent registries: 10k+ AI agents registered in months, discovering each other by on-chain handle"),
        ("Lido / Morpho / 4626 vaults", "yield infrastructure now speaks one standard interface"),
        ("Safe / DAO treasuries", "millions in small treasuries that nobody polices 24/7"),
    ]
    y = 2400
    for name, text in rows:
        row(pg, y, 1850, 0x1E2C47)
        txt(pg, 1700, y+150, 5200, 1500, [name], size=15.5, color=ACCENT, bold=True)
        txt(pg, 7200, y+130, 19300, 1600, [text], size=14, color=WHITE)
        y += 1950
    txt(pg, 1500, y+250, 25500, 900, ["Every one of these needs the same thing: strangers who reliably DO the boring work, paid on execution."], size=15, color=GOLD, bold=True)

def s_fit():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["The cellular fit: serve the giants, don't fight them"], size=28, color=ACCENT, bold=True)
    rows = [
        ("Keeper economy", "our pay-the-trigger-from-your-own-food primitive IS the Gelato/Keep3r model, native - cells pay keepers to run them; fat cells double the pay when gas is dear", GREEN),
        ("v4 hooks", "tuner-cells & auditor-cells sell hook parameter work via Membrane services; a colony's hook tenants spread blast radius instead of concentrating it", ACCENT),
        ("Aave edge", "liquidation squads as cells: Golgi payrolls, Adipocyte subsidies, Lysosome cleanup of dead positions", PURPLE),
        ("8004 / ENS", "cells are discoverable PAID services to the agent economy (registration surface shipped in v2.2)", GOLD),
        ("Micro-treasuries", "a cell already IS a Safe that runs itself: registry-gated organs + metabolic cycles; Safe users are customers, not competitors", "0x4ECDC4"),
    ]
    y = 2300
    for name, text, col in rows:
        c = col if isinstance(col, int) else int(col.replace("0x",""), 16)
        row(pg, y, 2050, 0x1E2C47, line=c)
        txt(pg, 1700, y+150, 4600, 1700, [name], size=15, color=c, bold=True)
        txt(pg, 6600, y+130, 19900, 1800, [text], size=13.5, color=WHITE)
        y += 2150
    txt(pg, 1500, y+200, 25500, 800, ["Refusals (from the audit): no mixers, no MEV/frontrunning, no stablecoin issuance. Infrastructure income only."], size=14, color=RED, bold=True)

def s_robust():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Why a swarm beats a monolith (the biology that pays)"], size=29, color=ACCENT, bold=True)
    txt(pg, 1500, 2400, 25500, 9600, bullets([
        (0, "N-VERSION DIVERSITY: 1,000 cells with different operators, venues, grafts and chains fail INDEPENDENTLY. One mega-bot fails every user at once."),
        (0, "GRACEFUL DEGRADATION: the expression cycle's per-organ gas stipend + OrganFailed containment means a broken organ is a bruise, not a death (A4-proven)."),
        (0, "SWARM ECONOMICS: each cell is a small profit-and-loss unit; bad strategies starve (they burn credits without income), good ones replicate. Selection pressure - the thing monoliths never have."),
        (0, "UPGRADE ISOLATION: template swap = speciation; a bad template kills one lineage, not the ecosystem."),
        (0, "WHAT WE DO NOT CLAIM: cells do not out-PERFORM monoliths on latency or depth. They out-SURVIVE them, and rent that resilience to the monoliths' users at the edge."),
    ]), size=17.5, space=11)

def s_next():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Status & next"], size=34, color=ACCENT, bold=True)
    txt(pg, 1500, 2400, 25500, 6800, bullets([
        (0, "Merge order: #18 (v2.0) -> #23 (v2.1) -> #28 (v2.2 audit) -> #31 (v2.3 fat+services). All OPEN for you; none self-merged."),
        (0, "85 tests passing, incl. a canary that will SCREAM when EIP-3298 deletes the clearing refund (first render-band assertion fails = blubber expired; rent keeps earning)."),
        (0, "Then: Base Sepolia deployment, Ownable2Step, slither + forge-invariant fuzz pass, ERC-4337/7702 keeper spike, real ERC-4626 venue adapter."),
    ]), size=17, space=10)
    row(pg, 11500, 3200, 0x1E2C47, line=GOLD)
    txt(pg, 1700, 11700, 24800, 2800, [
        "Artifacts: issues #29-#30, PR #31 w/ 6-point inline review, AUDIT.md addendum C1-C6, DESIGN.md 6a/6b, fat-study.json, this deck (docs/, 4th of a series).",
        "The organism can now hoard energy like fat, work like a service provider, and fail like a forest instead of like a server.",
    ], size=15, color=GOLD, space=6)

s_title(); s_physics(); s_design(); s_measured(); s_landscape(); s_fit(); s_robust(); s_next()

try:
    doc.DrawPages.remove(doc.DrawPages.getByIndex(0))
except Exception as e:
    print("note:", e)

out = "/home/orbit9/Work/cellular_autonoma/docs/"
doc.storeToURL("file://" + out + "Celular-Autonoma-v2.3-Fat-Cells-Services.odp", (pv("FilterName", "impress8"),))
doc.storeToURL("file://" + out + "Celular-Autonoma-v2.3-Fat-Cells-Services.pptx", (pv("FilterName", "Impress MS PowerPoint 2007 XML"),))
doc.storeToURL("file://" + out + "Celular-Autonoma-v2.3-Fat-Cells-Services.pdf", (pv("FilterName", "impress_pdf_Export"),))
print("slides:", doc.DrawPages.Count)
doc.close(False)
print("BUILT")
