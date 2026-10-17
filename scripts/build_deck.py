#!/usr/bin/env python3
import json, uno
from com.sun.star.beans import PropertyValue

GAS = json.load(open("/home/orbit9/Work/cellular_autonoma/gas-study.json"))

def pv(n, v):
    p = PropertyValue(); p.Name = n; p.Value = v; return p

local = uno.getComponentContext()
resolver = local.ServiceManager.createInstanceWithContext(
    "com.sun.star.bridge.UnoUrlResolver", local)
ctx = resolver.resolve("uno:socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext")
smgr = ctx.ServiceManager
desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)

doc = desktop.loadComponentFromURL("private:factory/simpress", "_blank", 0, (pv("Hidden", True),))
# 16:9 widescreen, 25400 x 14288 (1/100 mm) ~ but set explicit
try:
    dp = doc.DrawPages
    W, H = 28000, 15750  # ~ 16:9 in 1/100 mm
except Exception:
    pass

DARK = 0x14203A
ACCENT = 0x2E86AB
GREEN = 0x2E8B57
RED = 0xC0392B
GOLD = 0xB8860B
WHITE = 0xFFFFFF
GREY = 0x555F6E

def add_slide():
    doc.DrawPages.insertNewByIndex(doc.DrawPages.Count)
    pg = doc.DrawPages.getByIndex(doc.DrawPages.Count - 1)
    pg.Width = W
    pg.Height = H
    return pg

def bg(pg, color=DARK):
    r = doc.createInstance("com.sun.star.drawing.RectangleShape")
    s = uno.createUnoStruct("com.sun.star.awt.Size"); s.Width = W; s.Height = H
    p = uno.createUnoStruct("com.sun.star.awt.Point"); p.X = 0; p.Y = 0
    r.Size = s; r.Position = p
    r.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle", "SOLID")
    r.FillColor = color
    r.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle", "NONE")
    pg.add(r)

def box(pg, x, y, w, h):
    s = uno.createUnoStruct("com.sun.star.awt.Size"); s.Width = w; s.Height = h
    p = uno.createUnoStruct("com.sun.star.awt.Point"); p.X = x; p.Y = y
    return (s, p)

def txt(pg, x, y, w, h, lines, size=18, color=WHITE, bold=False, mono=False, align="LEFT", space=6):
    sh = doc.createInstance("com.sun.star.drawing.TextShape")
    sz, pt = box(pg, x, y, w, h)
    sh.Size = sz; sh.Position = pt
    sh.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle", "NONE")
    sh.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle", "NONE")
    sh.TextAutoGrowWidth = False
    sh.TextAutoGrowHeight = False
    pg.add(sh)
    cur = sh.Text.createTextCursor()
    enum_align = {"LEFT":"LEFT","CENTER":"CENTER","RIGHT":"RIGHT"}[align]
    if isinstance(lines, str):
        lines = [lines]
    for i, line in enumerate(lines):
        if i > 0:
            sh.Text.insertControlCharacter(cur, 0, False)  # 0 = PARAGRAPH_BREAK
        cur.setPropertyValue("CharHeight", size)
        cur.setPropertyValue("CharWeight", 100 if bold else 0)
        cur.setPropertyValue("CharColor", color)
        cur.setPropertyValue("CharFontName", "DejaVu Sans Mono" if mono else "DejaVu Sans")
        cur.setPropertyValue("ParaAdjust", uno.Enum("com.sun.star.style.ParagraphAdjust", align))
        cur.setPropertyValue("ParaBottomMargin", space)
        sh.Text.insertString(cur, line, False)
    return sh

def title_slide():
    pg = add_slide(); bg(pg, DARK)
    txt(pg, 1500, 4200, 25000, 2500, ["CELULAR  AUTONOMA  v2"], size=52, color=WHITE, bold=True)
    txt(pg, 1550, 6900, 25000, 1500, ["Self-replicating smart-contract cells that pay for themselves"], size=22, color=ACCENT)
    txt(pg, 1550, 8600, 25000, 3000, [
        "Findings, proposal, exploratory tests & results",
        "from orbitmechanic/cellular_autonoma",
        "Analysis + v2 reference implementation  -  2026",
    ], size=16, color=GREY, space=3)
    txt(pg, 1550, 13600, 25000, 800, ["39 passing tests  -  6 issues (#12-#17)  -  PR #18 (+2024 / -263)"], size=14, color=GREEN)

def bullets(lines):
    out = []
    for lvl, text in lines:
        pre = "" if lvl == 0 else "    "
        mark = "-  " if lvl == 0 else ".  "
        out.append(pre + mark + text)
    return out

def s_mission():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 900, 25000, 1400, ["The brief"], size=36, color=ACCENT, bold=True)
    txt(pg, 1500, 3000, 25000, 11000, bullets([
        (0, "Build a life-like 'cell' in Solidity: an address-linked collection of organelles on an EVM chain."),
        (0, "Nucleus holds identity + linked modules; Chloroplast stores energy (= capital); and so on."),
        (0, "Goal: a contract colony that self-replicates with NO human intervention."),
        (0, "It must find its own 'gas' for memory + processing once launched."),
        (0, "It must be capital-harvestable by the colony root deployer - 'or why bother?'."),
        (0, "v1 stalled on gas costs and gaps that needed better code. Can we do better?"),
    ]), size=19, space=10)

def s_constraint():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 900, 25000, 1400, ["The hard constraint (why v1 stalled)"], size=34, color=ACCENT, bold=True)
    txt(pg, 1500, 2900, 25000, 1600, ["On the EVM, a contract can NEVER send its own transaction. Only an external account (or smart-account relayer) pays gas and initiates."], size=18, color=WHITE)
    txt(pg, 1500, 5000, 12000, 8000, ["Three ways to relax it"], size=22, color=GOLD, bold=True)
    txt(pg, 1500, 5900, 12500, 8000, bullets([
        (0, "1. Cheap chain: L2 / near-free so a division costs cents, not dollars."),
        (0, "2. Keeper economics: the cell pays whoever triggers it, from capital it earned."),
        (0, "3. ERC-4337 paymasters: a bundler pays gas, cell settles in tokens."),
    ]), size=17, space=8)
    r = doc.createInstance("com.sun.star.drawing.RectangleShape")
    sz, pt = box(pg, 14800, 5000, 11700, 8600); sz and None
    r.Size = sz; r.Position = pt
    r.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle","SOLID"); r.FillColor = 0x1E2C47
    r.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle","NONE"); pg.add(r)
    txt(pg, 15100, 5200, 11100, 2600, ["v1 did none of these fully."], size=20, color=RED, bold=True)
    txt(pg, 15100, 6200, 11100, 6600, [
        "L1 division cost (measured):",
        "  v1 ~$82    v2 ~$49",
        "So the loop could never pay its",
        "own gas and the colony starved",
        "in the first few generations.",
    ], size=17, color=WHITE, mono=True, space=4)

def s_findings():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 600, 25500, 1200, ["Findings: six verified v1 failures"], size=34, color=ACCENT, bold=True)
    rows = [
        ("#12", "Dead capital", "Keeper pays 100% gas; estimate is hoarded, never reimbursed"),
        ("#14", "Proxy-depth bloat", "Clones live instances -> +1 DELEGATECALL each generation"),
        ("#14", "Identity bloat", "'...copy copy' string grows unbounded (10->35 bytes/gen)"),
        ("#15", "No harvest", "Capital never reaches the root owner (the whole point)"),
        ("#16", "Broken gate", "Membership check reverts wrong; any organelle can withdraw; daughters inherit the mother's metabolism"),
        ("#17", "Tests broken", "ethers v5 code on a v6 toolchain: 0 passing; references a non-existent factory"),
    ]
    y = 3200
    txt(pg, 1500, 1900, 25500, 700, ["Each is reproduced by an executable characterization test in the PR."], size=15, color=GREY)
    for iss, head, desc in rows:
        r = doc.createInstance("com.sun.star.drawing.RectangleShape")
        sz, pt = box(pg, 1500, y, 25300, 1700); sz and None
        r.Size = sz; r.Position = pt
        r.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle","SOLID")
        r.FillColor = 0x1E2C47 if (int(y)//1700) % 2 == 0 else 0x22324F
        r.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle","NONE"); pg.add(r)
        txt(pg, 1650, y+150, 2200, 1400, ["#"+iss], size=17, color=GOLD, bold=True)
        txt(pg, 3900, y+150, 6500, 1400, [head], size=17, color=ACCENT, bold=True)
        txt(pg, 10500, y+150, 16000, 1450, [desc], size=15, color=WHITE)
        y += 1750

def s_bloat_data():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 800, 25500, 1400, ["Exploratory result: inherited gas bloat"], size=32, color=ACCENT, bold=True)
    idg = GAS["v1_identity_call_gas_by_depth"]
    ekg = GAS["v2_energy_call_gas_by_depth"]
    txt(pg, 1500, 2400, 12000, 1200, ["v1 identity() call gas by generation"], size=17, color=RED, bold=True)
    txt(pg, 1500, 3500, 12000, 9000, ["  gen%d: %7d gas" % (i+1, g) for i, g in enumerate(idg)] +
        ["  +58% by gen 6, still climbing"], size=17, color=WHITE, mono=True, space=3)
    txt(pg, 14800, 2400, 12000, 1200, ["v2 getBalance() call gas by generation"], size=17, color=GREEN, bold=True)
    txt(pg, 14800, 3500, 12000, 9000, ["  gen%d: %7d gas" % (i+1, g) for i, g in enumerate(ekg)] +
        ["", "  FLAT - clone from template, not instance"], size=17, color=WHITE, mono=True, space=3)
    txt(pg, 1500, 12600, 25500, 1200, ["v2 kills the compounding by cloning immutable TEMPLATES in Colony.birth(). A colony no longer gets pricier to run as it ages."], size=15, color=GOLD)

def s_cost():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 800, 25500, 1400, ["Proposal: chain choice decides viability"], size=32, color=ACCENT, bold=True)
    txt(pg, 1500, 2300, 25500, 1000, ["One full v2 division ~= 1.08M gas. Projected USD cost per self-replication:"], size=17, color=WHITE)
    v1c = {c["chain"]: c["usd"] for c in GAS["cost_per_v1_division_usd"]}
    v2c = {c["chain"]: c["usd"] for c in GAS["cost_per_v2_division_usd"]}
    order = ["Ethereum L1", "Arbitrum One", "OP Mainnet (base)", "Base", "Polygon PoS", "Sonic"]
    cols = [("", 1200, 6800), ("v1 $", 8200, 3500), ("v2 $", 11800, 3500), ("verdict", 15400, 11000)]
    y = 3500
    # header
    r = doc.createInstance("com.sun.star.drawing.RectangleShape")
    sz, pt = box(pg, 1200, y-100, 25300, 900); sz and None
    r.Size = sz; r.Position = pt; r.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle","SOLID")
    r.FillColor = ACCENT; r.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle","NONE"); pg.add(r)
    txt(pg, 1400, y+50, 6600, 800, ["Chain"], size=16, color=DARK, bold=True)
    txt(pg, 8200, y+50, 3500, 800, ["v1 / div"], size=16, color=DARK, bold=True, align="RIGHT")
    txt(pg, 11800, y+50, 3500, 800, ["v2 / div"], size=16, color=DARK, bold=True, align="RIGHT")
    txt(pg, 15400, y+50, 11000, 800, ["Self-sustaining?"], size=16, color=DARK, bold=True)
    y += 1000
    for chain in order:
        v = v2c[chain]
        if chain == "Ethereum L1":
            verdict, vc = "NO - keeper can't profit at scale", RED
        elif v < 0.001:
            verdict, vc = "NEAR-FREE - best raw economics", GREEN
        elif v < 0.05:
            verdict, vc = "YES - cheap + huge DeFi/AI ecosystem", GREEN
        elif v < 0.4:
            verdict, vc = "MARGINAL - viable for high-value cells", GOLD
        else:
            verdict, vc = "NO - too costly for free replication", RED
        rr = doc.createInstance("com.sun.star.drawing.RectangleShape")
        sz, pt = box(pg, 1200, y, 25300, 950); sz and None
        rr.Size = sz; rr.Position = pt; rr.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle","SOLID")
        rr.FillColor = 0x1E2C47 if int(y)//950 % 2 == 0 else 0x22324F
        rr.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle","NONE"); pg.add(rr)
        txt(pg, 1400, y+80, 6600, 800, [chain], size=16, color=WHITE, bold=True)
        txt(pg, 8200, y+80, 3500, 800, ["$%.4f" % v1c[chain]], size=15, color=GREY, mono=True, align="RIGHT")
        txt(pg, 11800, y+80, 3500, 800, ["$%.4f" % v], size=15, color=WHITE, mono=True, align="RIGHT")
        txt(pg, 15400, y+80, 11000, 800, [verdict], size=14, color=vc, bold=True)
        y += 1000
    txt(pg, 1500, 13600, 25500, 1000, ["Recommendation: launch on Base (ecosystem to earn from) and/or Sonic (near-free division). Same EVM bytecode both."], size=16, color=GOLD, bold=True)

def s_arch():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 800, 25500, 1400, ["The v2 organism: Colony + organelles"], size=32, color=ACCENT, bold=True)
    items = [
        ("Colony", "The one trusted mitosis engine. Clones organelles from immutable templates and wires each daughter. plantRoot / birth / harvest / graft / apoptosis.", ACCENT),
        ("Nucleus", "Identity (serial + generation), capability-role registry, lineage tracked both directions (parent + children).", GREEN),
        ("EnergyStore", "The 'food'. Per-payer ledger, role-gated withdrawals, pull-payment keeper credits, remitUp tithes.", GOLD),
        ("Chloroplast", "Metabolism + replication. Gated replicate(): cooldown, generation cap, reserve floor. Pays the keeper.", 0x8E44AD),
    ]
    y = 2700
    for name, desc, col in items:
        r = doc.createInstance("com.sun.star.drawing.RectangleShape")
        sz, pt = box(pg, 1500, y, 25300, 2100); sz and None
        r.Size = sz; r.Position = pt
        r.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle","SOLID"); r.FillColor = 0x1E2C47
        r.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle","SOLID"); r.LineColor = col
        r.LineWidth = 60; pg.add(r)
        txt(pg, 1800, y+200, 6000, 1700, [name], size=22, color=col, bold=True)
        txt(pg, 8000, y+200, 18500, 1700, [desc], size=16, color=WHITE)
        y += 2300

def s_econ():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 800, 25500, 1400, ["Economic autonomy (the achievable version)"], size=30, color=ACCENT, bold=True)
    txt(pg, 1500, 2400, 25500, 1400, ["A cell still can't send its own tx - but ANYONE can trigger it and get paid from the cell's own earned food. Triggering becomes a job."], size=17, color=WHITE)
    # left: how it pays
    txt(pg, 1500, 4200, 12000, 1000, ["Repayment loop"], size=20, color=GREEN, bold=True)
    txt(pg, 1500, 5300, 12500, 8000, bullets([
        (0, "Keeper calls replicate() from an EOA / Automation / bot."),
        (0, "Cell credits the keeper's gas (budgeted, capped by maxRefundCap/Bps)."),
        (0, "Pull-payment ledger: keeper claims later; harvest can't strand it."),
        (0, "On Base/Sonic the credit is tiny, so division self-funds."),
    ]), size=16, space=7)
    # right: harvest
    txt(pg, 14800, 4200, 12000, 1000, ["Harvest to the root (the 'or why bother')"], size=20, color=GOLD, bold=True)
    txt(pg, 14800, 5300, 12500, 8000, bullets([
        (0, "birthFee per division accrues to the Colony treasury."),
        (0, "birth tithe: a slice of each daughter flows back up the tree."),
        (0, "harvestColony: gas-bounded BFS sweeps every cell to the owner."),
        (0, "apoptosis: retire a cell, reclaim its capital."),
    ]), size=16, space=7)

def s_metabolism():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 800, 25500, 1400, ["What cells do - and how they earn"], size=32, color=ACCENT, bold=True)
    txt(pg, 1500, 2300, 25500, 1000, ["A cell must earn more food than it burns paying its metabolism, or it dies. v2 ships the per-payer ledger + RESERVE/graft slots these plug into."], size=15, color=GREY)
    txt(pg, 1500, 3600, 12500, 1000, ["Metabolism (income)"], size=20, color=GREEN, bold=True)
    txt(pg, 1500, 4600, 12800, 8500, bullets([
        (0, "Keeper-for-hire relayer (Chainlink Automation / Gelato)."),
        (0, "Yield: idle food into Aave/Morpho/LSTs = true photosynthesis."),
        (0, "Service endpoints sold to AI agents (attestation, escrow, clocks)."),
        (0, "Storage / registry rent for other contracts."),
    ]), size=16, space=8)
    txt(pg, 14800, 3600, 12500, 1000, ["Multicellular organisms"], size=20, color=ACCENT, bold=True)
    txt(pg, 14800, 4600, 12800, 8500, bullets([
        (0, "Divide labour: siblings carry different RESERVE/service organelles."),
        (0, "Shared genome: template clones -> 1000-cell colony, linear cost."),
        (0, "Apoptosis retires sick cells, keeps the organism healthy."),
        (0, "Colony treasury + membranes are counterparties to protocols, bots and humans."),
    ]), size=16, space=8)

def s_tests():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 800, 25500, 1400, ["Tests & results"], size=34, color=ACCENT, bold=True)
    stats = [("39", "tests passing", GREEN), ("6", "issues filed #12-#17", GOLD),
             ("PR#18", "+2024 / -263", ACCENT), ("41%", "cheaper division", 0x8E44AD)]
    x = 1500
    for big, small, col in stats:
        r = doc.createInstance("com.sun.star.drawing.RectangleShape")
        sz, pt = box(pg, x, 2800, 5800, 3200); sz and None
        r.Size = sz; r.Position = pt
        r.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle","SOLID"); r.FillColor = 0x1E2C47
        r.LineStyle = uno.Enum("com.sun.star.drawing.LineStyle","SOLID"); r.LineColor = col; r.LineWidth = 50
        pg.add(r)
        txt(pg, x, 3200, 5800, 1600, [big], size=40, color=col, bold=True, align="CENTER")
        txt(pg, x+200, 4900, 5400, 1000, [small], size=15, color=WHITE, align="CENTER")
        x += 6000
    txt(pg, 1500, 6600, 25500, 1200, ["Suites"], size=20, color=GOLD, bold=True)
    txt(pg, 1500, 7600, 25500, 6500, bullets([
        (0, "3 x v1 characterization suites - prove each flaw is real (and quantify the bloat)."),
        (0, "v2-cell.test.js - genesis, roles, mitosis, template-clone flatness, generation cap, symbiosis, apoptosis."),
        (0, "v2-economics.test.js - keeper whole, refund caps, tithes, harvestColony tree-walk, fee treasury."),
        (0, "scripts/gas-study.js regenerates gas-study.json (the bloat + cross-chain tables in this deck)."),
    ]), size=16, space=8)

def s_compare():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 800, 25500, 1400, ["v1 vs v2, at a glance"], size=34, color=ACCENT, bold=True)
    rows = [
        ("Who divides", "caller pays gas, unreimbursed", "cell reimburses keeper (pull)"),
        ("Cloning", "live instances (bloat)", "immutable templates (flat)"),
        ("Identity", "'...copy copy' unbounded", "serial + generation, cell#N"),
        ("Fund authority", "any organelle, revert bug", "role-gated METABOLISM/Colony"),
        ("Daughter wiring", "shares mother's metabolism", "fresh trio, assembled by Colony"),
        ("Harvest", "none", "tithe + fee + tree sweep"),
        ("Division limits", "none", "cooldown + gen-cap + reserve"),
        ("Tests", "0 passing (broken)", "39 passing"),
        ("Division gas", "1.82M", "1.08M (-41%)"),
    ]
    y = 2400
    txt(pg, 1400, y-100, 5200, 700, ["Aspect"], size=15, color=DARK, bold=True)
    r = doc.createInstance("com.sun.star.drawing.RectangleShape"); sz,pt = box(pg,1400,y-150,25300,850); sz and None
    r.Size=sz; r.Position=pt; r.FillStyle=uno.Enum("com.sun.star.drawing.FillStyle","SOLID"); r.FillColor=ACCENT
    r.LineStyle=uno.Enum("com.sun.star.drawing.LineStyle","NONE"); pg.add(r)
    txt(pg, 1600, y-50, 5200, 700, ["Aspect"], size=16, color=DARK, bold=True)
    txt(pg, 7000, y-50, 9000, 700, ["v1"], size=16, color=DARK, bold=True)
    txt(pg, 16200, y-50, 10500, 700, ["v2 (this PR)"], size=16, color=DARK, bold=True)
    y += 900
    for a, b, c in rows:
        rr = doc.createInstance("com.sun.star.drawing.RectangleShape"); sz,pt = box(pg,1400,y,25300,950); sz and None
        rr.Size=sz; rr.Position=pt; rr.FillStyle=uno.Enum("com.sun.star.drawing.FillStyle","SOLID")
        rr.FillColor = 0x1E2C47 if int(y)//950 %2==0 else 0x22324F
        rr.LineStyle=uno.Enum("com.sun.star.drawing.LineStyle","NONE"); pg.add(rr)
        txt(pg, 1600, y+90, 5200, 800, [a], size=15, color=ACCENT, bold=True)
        txt(pg, 7000, y+90, 9000, 800, [b], size=14, color=GREY)
        txt(pg, 16200, y+90, 10500, 850, [c], size=14, color=WHITE)
        y += 1000

def s_roadmap():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 800, 25500, 1400, ["Recommendation & next steps"], size=32, color=ACCENT, bold=True)
    txt(pg, 1500, 2600, 25500, 1200, ["Ship the same EVM bytecode to Base and/or Sonic. Merge PR #18, then build the income organelles."], size=18, color=WHITE, bold=True)
    txt(pg, 1500, 4200, 25500, 10000, bullets([
        (0, "1. Deploy Colony to a Base Sepolia testnet; publish keeper-reimbursement params."),
        (0, "2. Build Membrane (metered per-payer income) + a yield RESERVE - the real photosynthesis."),
        (0, "3. Wrap Chloroplast as an ERC-4337 smart account so a paymaster pays gas in tokens."),
        (0, "4. Governance organelle -> owner-less colonies; reputation scoring for which cells to propagate."),
        (0, "5. Turntable run: a colony living on its own earned income for N days; measure harvest-to-root vs gas burned."),
    ]), size=19, space=11)
    txt(pg, 1500, 13500, 25500, 1000, ["Honest bottom line: 'self-replicating without humans' is unachievable literally; economically autonomous + harvestable IS achievable, and now runs green."], size=15, color=GOLD)

def s_artifacts():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 800, 25500, 1400, ["Artifacts"], size=34, color=ACCENT, bold=True)
    txt(pg, 1500, 2800, 25500, 1000, ["github.com/orbitmechanic/cellular_autonoma"], size=22, color=WHITE, bold=True, mono=True)
    txt(pg, 1500, 4400, 12500, 1000, ["Issues (found)"], size=20, color=GOLD, bold=True)
    txt(pg, 1500, 5400, 12800, 7500, bullets([
        (0, "#13 autonomy / gas blocker (design)"),
        (0, "#12 keeper reimbursement"),
        (0, "#14 proxy + identity bloat"),
        (0, "#15 harvest to root"),
        (0, "#16 roles / metabolism / gate"),
        (0, "#17 broken test suite"),
    ]), size=16, space=6)
    txt(pg, 14800, 4400, 12500, 1000, ["Shipped (PR #18)"], size=20, color=GREEN, bold=True)
    txt(pg, 14800, 5400, 12800, 7500, bullets([
        (0, "contracts/v2/  ICell, Nucleus, EnergyStore,"),
        (1, "Chloroplast, Colony"),
        (0, "2 v2 suites + 3 v1 characterization suites"),
        (0, "scripts/gas-study.js + gas-study.json"),
        (0, "DESIGN.md (full findings + strategy)"),
        (0, "inline code review (7 notes) on PR #18"),
    ]), size=16, space=6)
    txt(pg, 1500, 13200, 25500, 1000, ["Status: PR #18 OPEN for review. Not self-merged (security rewrite)."], size=16, color=ACCENT, bold=True)

title_slide(); s_mission(); s_constraint(); s_findings(); s_bloat_data()
s_cost(); s_arch(); s_econ(); s_metabolism(); s_tests(); s_compare(); s_roadmap(); s_artifacts()

# delete the initial blank first page (index 0) that factory created
if doc.DrawPages.Count > 0:
    try:
        # the factory's default empty page is at index 0; remove it
        doc.DrawPages.remove(doc.DrawPages.getByIndex(0))
    except Exception as e:
        print("note: could not remove default page:", e)

out = "/home/orbit9/Work/cellular_autonoma/docs/"
doc.storeToURL("file://" + out + "Celular-Autonoma-v2.odp", (pv("FilterName", "impress8"),))
doc.storeToURL("file://" + out + "Celular-Autonoma-v2.pptx", (pv("FilterName", "Impress MS PowerPoint 2007 XML"),))
doc.storeToURL("file://" + out + "Celular-Autonoma-v2.pdf", (pv("FilterName", "impress_pdf_Export"),))
print("slides:", doc.DrawPages.Count)
doc.close(False)
print("BUILT")
