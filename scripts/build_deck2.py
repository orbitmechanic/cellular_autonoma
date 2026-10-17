#!/usr/bin/env python3
import json, uno
from com.sun.star.beans import PropertyValue

STUDY = json.load(open("/home/orbit9/Work/cellular_autonoma/organelle-study.json"))

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

# ---- slides ----

def s_title():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 3800, 25000, 2600, ["CELULAR AUTONOMA  v2.1"], size=50, color=WHITE, bold=True)
    txt(pg, 1550, 6600, 25000, 1400, ["The full organelle cast - a cell that can work, not just divide"], size=22, color=ACCENT)
    txt(pg, 1550, 8300, 25000, 2200, [
        "7 optional, graftable smart-contract organelles,",
        "wired through a gene-expression cycle.",
    ], size=16, color=GREY, space=3)
    txt(pg, 1550, 13600, 25000, 800, ["68 tests passing  -  issues #19-#22  -  PR #23 (stacked on #18)"], size=14, color=GREEN)

def s_why():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 800, 25500, 1400, ["What v2.0 still couldn't do"], size=34, color=ACCENT, bold=True)
    txt(pg, 1500, 2600, 25500, 10000, bullets([
        (0, "v2.0 made the cell SELF-FUNDING (keeper credits) and HARVESTABLE (tithes, fees, sweeps)."),
        (0, "But it could only do two things: store capital and divide. It had no hands and no job:"),
        (1, "nothing earned income from the world outside (no services to sell)"),
        (1, "nothing grew the capital it held (no respiration of idle funds)"),
        (1, "nothing kept house: no scheduling, no cleanup, no defense, no long-horizon storage"),
        (0, "Cell theory has an answer for every one of those gaps - an organelle."),
        (0, "v2.1 installs the rest of the cast as OPTIONAL modules that plug into the living cell."),
    ]), size=19, space=10)

def s_map():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Cell theory -> contract theory"], size=32, color=ACCENT, bold=True)
    rows = [
        ("Mitochondrion", "respiration -> ATP", "deploys surplus capital to a yield venue, harvests accrued ATP back as food, breathes out when the cell needs liquidity", PURPLE),
        ("Ribosome", "mRNA -> protein", "translates approved 'genes' (templates) into fresh module clones - the in-cell evolution engine", GREEN),
        ("Golgi", "package & ship", "scheduled, memo-tagged batch payments; ships a batch whole or not at all", ACCENT),
        ("Lysosome", "digest & recycle", "reclaims expired keeper credits into the cell, evicts condemned organs, sweeps dust", GOLD),
        ("Peroxisome", "detoxify", "quorum-reported agents get flagged; their revenue is sequestered, not slashed", RED),
        ("Vacuole", "storage & turgor", "timed tranches + jury-only quarantine custody + pressure() metric the harvest honors", 0x2E8B57),
        ("Membrane", "selective permeability", "PRICED service receptors - the income organ: bots/agents/protocols pay per bind", ACCENT),
    ]
    y = 1900
    for name, bio, job, col in rows:
        row(pg, y, 1650, 0x1E2C47, line=col)
        txt(pg, 1700, y + 140, 4800, 1400, [name], size=17, color=col, bold=True)
        txt(pg, 6600, y + 140, 4600, 1400, [bio], size=13, color=GREY)
        txt(pg, 11400, y + 110, 15100, 1500, [job], size=13, color=WHITE)
        y += 1750
    txt(pg, 1500, 14350, 25500, 800, ["Nucleolus = Colony template governance (shipped in v2.0)   -   cytoskeleton = the Nucleus registry (already anchors every organ)"], size=13, color=GREY)

def s_expression():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Gene expression: how optional organs run themselves"], size=30, color=ACCENT, bold=True)
    steps = [
        ("1", "keeper calls Chloroplast.express()", "anyone can work the cell; any work pays"),
        ("2", "EnergyStore.startCycle()", "cycle nonce++; the SPEND WINDOW opens"),
        ("3", "authorize(worker, budget)", "budget = min(25% of remaining food, perWorkerCeiling), recomputed per organ"),
        ("4", "worker.act(budget)  [try/catch]", "organs do their jobs; a failing organ is skipped, never bricks the cell"),
        ("5", "endCycle() + keeper refund", "window closes; unspent ceilings are now unreachable; trigger gets paid"),
    ]
    y = 2300
    for num, code, note in steps:
        row(pg, y, 1700, 0x1E2C47)
        txt(pg, 1700, y + 120, 900, 1400, [num], size=30, color=GOLD, bold=True)
        txt(pg, 2800, y + 220, 11200, 1300, [code], size=16, color=WHITE, mono=True)
        txt(pg, 14400, y + 180, 12100, 1400, [note], size=14, color=GREY)
        y += 1800
    txt(pg, 1500, 13600, 25500, 1200, ["Organelles NEVER hold treasury keys. Capability = a live registry fact: condemn an organ and its power dies instantly, no state to clean."], size=15, color=GOLD, bold=True)

def s_capability():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["The capability model (what a grafted stranger can do)"], size=29, color=ACCENT, bold=True)
    txt(pg, 1500, 2350, 12500, 1000, ["Every money path is bounded 4x:"], size=19, color=WHITE, bold=True)
    txt(pg, 1500, 3500, 12800, 8500, bullets([
        (0, "1. ROLE: spend() needs a CURRENT WORKER registration in THIS cell."),
        (0, "2. WINDOW: spend only works inside an active express() cycle - idle grafts are inert."),
        (0, "3. CEILING: per-cycle, nonce-scoped - unspent authorization simply dies."),
        (0, "4. RESERVE: discretionary balance only; keeper-owed ETH is untouchable by organs AND harvest."),
    ]), size=15.5, space=8)
    row(pg, 2500, 10200, 0x1E2C47, line=RED, x=14300, w=12400)
    txt(pg, 14500, 2700, 11700, 1200, ["The hole I found in my own draft"], size=18, color=RED, bold=True)
    txt(pg, 14500, 4000, 11700, 8200, [
        "Ceilings alone leaked: a worker could call spend() between cycles against its leftover grant.",
        "",
        "Fixed in review: startCycle opens the window, endCycle closes it. A malicious grafted organ can now extract AT MOST one per-worker ceiling per cycle - and only while the metabolism is deliberately activating it.",
        "",
        "Test: 'the spend window is open only while the cell is working'.",
    ], size=14.5, color=WHITE, space=5)

def s_income():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["The two income organs"], size=34, color=ACCENT, bold=True)
    row(pg, 2300, 10300, 0x1E2C47, line=GREEN, x=1400, w=12400)
    txt(pg, 1800, 2500, 11500, 1000, ["Membrane - photosynthesis (outside)"], size=20, color=GREEN, bold=True)
    txt(pg, 1800, 3600, 11500, 8800, bullets([
        (0, "Cell advertises services: receptor = priced endpoint."),
        (0, "AI agents / bots / protocols bind by paying the fee; funds flow straight to the cell's food."),
        (0, "Per-payer ledger (what the Peroxisome meters), rate windows, overpay refunds, shield-checked admission."),
        (0, "This is 'a useful function for the community' - the founding brief - as an on-market menu."),
    ]), size=15, space=8)
    row(pg, 2300, 10300, 0x1E2C47, line=PURPLE, x=14300, w=12400)
    txt(pg, 14500, 2500, 11500, 1000, ["Mitochondrion - respiration (inside)"], size=20, color=PURPLE, bold=True)
    txt(pg, 14500, 3600, 11700, 8800, bullets([
        (0, "Idle food earns nothing. Each cycle the mito deploys surplus to a yield venue (IYield adapter)."),
        (0, "Accrued interest = ATP: harvested home as FOOD, on the books via principal tracking."),
        (0, "Breathes OUT (unstakes) when division or shipments need liquidity - float floor enforced."),
        (0, "Real deployment = Aave v3 / ERC-4626 adapter behind the same 4-line interface."),
    ]), size=15, space=8)

def s_housekeeping():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["The housekeeping organs"], size=34, color=ACCENT, bold=True)
    rows = [
        ("Golgi", ACCENT, "schedule(to, amount, dueAt, memo) -> batch ships atomically when due & affordable. Bounded payroll for an agent economy. Known limit: a recipient that rejects ETH poisons its batch (cancel() is the lever; dead-letter queue is the fix)."),
        ("Lysosome", GOLD, "keeper credits unpaid past the colony TTL are digested back into the cell (an un-pulled payment was never operationally owed); condemned organs get evicted from the registry; its own dust sweeps home."),
        ("Peroxisome", RED, "accusations need QUORUM of distinct reporters and enrich the accuser with NOTHING - the only consequence is isolation in the vacuole, released by a jury (the Colony). Reputation with skin in the game, not vigilante finance."),
        ("Vacuole", GREEN, "timed tranches flow back to the cell when mature; quarantine tranches never auto-release; pressure() is the turgor metric - the cell's long-horizon capital."),
    ]
    y = 2200
    for name, col, text in rows:
        row(pg, y, 2700, 0x1E2C47, line=col)
        txt(pg, 1700, y + 180, 3600, 2300, [name], size=20, color=col, bold=True)
        txt(pg, 5600, y + 140, 20900, 2500, [text], size=14, color=WHITE)
        y += 2900

def s_results():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Exploratory results"], size=34, color=ACCENT, bold=True)
    stats = [("68", "tests passing", GREEN), ("+29", "v2.1 suite", ACCENT), ("0", "regressions", GOLD)]
    x = 1500
    for big, small, col in stats:
        row(pg, 2300, 3000, 0x1E2C47, line=col, x=x, w=7900)
        txt(pg, x, 2500, 7900, 1600, [big], size=42, color=col, bold=True, align="CENTER")
        txt(pg, x + 200, 4200, 7500, 900, [small], size=15, color=WHITE, align="CENTER")
        x += 8700
    txt(pg, 1500, 5900, 25500, 900, ["Gas (scripts/organelle-study.js):"], size=18, color=WHITE, bold=True)
    rows = [
        ("idle express() (no workers)", STUDY["express_idle_gas"]),
        ("full 6-organ cast, cold cycle", STUDY["express_full_cast_gas"]),
        ("full cast, warm cycle", STUDY["express_cycle2_gas"]),
        ("mitosis WITH complete proteome (7 organs cloned+bound)", STUDY["replicate_with_proteome_gas"]),
    ]
    y = 6900
    for label, g in rows:
        usd_base = g * 0.01e-9 * 3000  # Base @ 0.01 gwei, ETH $3000
        txt(pg, 1700, y, 16500, 800, [label], size=15, color=WHITE)
        txt(pg, 18400, y, 4200, 800, ["%,d gas".replace("%,d", "{:,}").format(g)], size=15, color=GOLD, mono=True, align="RIGHT")
        txt(pg, 22800, y, 3800, 800, ["~$%.4f" % usd_base], size=15, color=GREEN, mono=True, align="RIGHT")
        y += 900
    txt(pg, 1500, 13300, 25500, 1400, ["A daughter is born with its mother's whole proteome (6 workers + membrane, 10 registry entries, fresh single-hop clones). Running an entire multi-organ cell costs the price of a coffee crumb on Base/Sonic."], size=14.5, color=GREY)

def s_honest():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Honest notes from the review"], size=34, color=ACCENT, bold=True)
    txt(pg, 1500, 2500, 25500, 10800, bullets([
        (0, "MockYieldVault is a TOY (linear bps, no share accounting, unguarded drain()) - never deploy it; real work = ERC-4626 / Aave adapter behind the same IYield surface."),
        (0, "Peroxisome screening is heuristic reputation, not truth - consequence is isolation pending a COLONY JURY, never slashing, never accuser profit."),
        (0, "lockQuarantine trusts any WORKER (registry has no per-name identity yet) - harmless: quarantine locks the depositer's own funds behind the jury."),
        (0, "Golgi batches can be poisoned by one ETH-rejecting recipient (all-or-nothing per batch) - cancel() exists; dead-letter delivery is the next-iteration fix."),
        (0, "digestExpiredCredits scans O(maxOps)/cycle - fine at colony scale, needs an index at internet scale."),
        (0, "administer = owner config power; justified because the owner already has full capital power by design - its production replacement is a governance organelle, not a new key."),
    ]), size=17, space=11)

def s_next():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["What a whole organism is now for"], size=32, color=ACCENT, bold=True)
    txt(pg, 1500, 2400, 25500, 8200, bullets([
        (0, "Differentiation: same genome, different grafts - one colony now grows cell TYPES: relayer cells (membrane jobs), vault cells (mito posture), escrow cells (golgi schedules)."),
        (0, "The ribosome is the evolution engine: approved genes -> products -> graft; next step is genes chosen BY the colony's own governance organ."),
        (0, "Epigenetics: an expression-policy module to decide which configured organs a daughter inherits."),
        (0, "Production: Base Sepolia deployment, Aave IYield adapter, ERC-4337 paymaster so keepers need no wallet at all."),
        (0, "The turntable run: a 30-cell colony with the full cast, harvesting to root daily, measured on its own earned income for N days."),
    ]), size=18, space=12)
    row(pg, 11700, 2900, 0x1E2C47, line=GOLD)
    txt(pg, 1700, 11900, 24800, 2500, [
        "Artifacts: issues #19-#22  -  PR #23 (stacked on #18, OPEN for you) with 9-point inline review  -  68 green tests  -  DESIGN.md organelle map  -  this deck (docs/).",
        "Keet ping sent. Cell theory, compiled.",
    ], size=15, color=GOLD, space=6)

s_title(); s_why(); s_map(); s_expression(); s_capability(); s_income()
s_housekeeping(); s_results(); s_honest(); s_next()

# remove the factory's initial blank page
try:
    doc.DrawPages.remove(doc.DrawPages.getByIndex(0))
except Exception as e:
    print("note:", e)

out = "/home/orbit9/Work/cellular_autonoma/docs/"
doc.storeToURL("file://" + out + "Celular-Autonoma-v2.1-Organelles.odp", (pv("FilterName", "impress8"),))
doc.storeToURL("file://" + out + "Celular-Autonoma-v2.1-Organelles.pptx", (pv("FilterName", "Impress MS PowerPoint 2007 XML"),))
doc.storeToURL("file://" + out + "Celular-Autonoma-v2.1-Organelles.pdf", (pv("FilterName", "impress_pdf_Export"),))
print("slides:", doc.DrawPages.Count)
doc.close(False)
print("BUILT")
