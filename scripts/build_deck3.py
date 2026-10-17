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


# ---- v2.2 slides ----

def s_title():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 3600, 25000, 2600, ["CELULAR AUTONOMA  v2.2"], size=50, color=WHITE, bold=True)
    txt(pg, 1550, 6400, 25000, 1400, ["ERCs, defenses, and a full-system security audit"], size=22, color=ACCENT)
    txt(pg, 1550, 8200, 25000, 2000, [
        "Every public ERC/EIP that touches an autonomous cell:",
        "adopt what helps - reject what hurts - prove the rest.",
    ], size=16, color=GREY, space=3)
    txt(pg, 1550, 13600, 25000, 800, ["79 tests passing  -  issues #24-#27  -  PR #28 (stacked)  -  AUDIT.md findings register"], size=14, color=GREEN)

def s_method():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 800, 25500, 1400, ["How the audit was run"], size=34, color=ACCENT, bold=True)
    txt(pg, 1500, 2600, 25500, 10000, bullets([
        (0, "SCOPE: 14 production contracts - v2.0 core trio + Colony, v2.1 organ cast (7 + base), interfaces."),
        (0, "METHOD: line-by-line manual review of every state-changing function - authority, CEI ordering, value-flow, revert-mode."),
        (0, "ADVERSARY LENS: stranger EOA - botched graft - MALICIOUS grafted organ - dishonest keeper - hostile colony owner - failing yield venue."),
        (0, "INVARIANTS FIRST: 7 system invariants written down (I1-I7 in AUDIT.md), each mapped to its enforcement point."),
        (0, "EVIDENCE: every finding gets an executable regression (test/v2.2-audit.test.js A1-A11) - findings that cannot be tested are marked as such."),
        (0, "RESULT: 18 findings - 11 fixed in code, 4 documented-accepted, 3 recommendations; 0 unresolved Highs."),
    ]), size=18, space=11)

def s_adopted():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Adopted: standards the cell now speaks"], size=32, color=ACCENT, bold=True)
    cards = [
        ("ERC-165", "interface detection", "The Nucleus registry REFUSES a WORKER graft that can't declare IWorker; the Membrane refuses a shield that can't speak screen(). Graft-time proof replaces runtime guessing.", ACCENT),
        ("ERC-4626", "yield vaults", "The Mitochondrion speaks the standard vault interface (deposit/withdraw/preview/max*). Aave, Morpho, LST wrappers become drop-in respiratory substrates - no bespoke venue surface to trust.", PURPLE),
        ("ERC-8004", "trustless agents", "Membrane carries the discovery fields the (Jan-2026 mainnet-live) agent registries point at: agentName, registrationURI. Cells show up on the agents' menu without building any registry.", GREEN),
    ]
    x = 1500
    for name, sub, text, col in cards:
        row(pg, 2300, 10400, 0x1E2C47, line=col, x=x, w=8300)
        txt(pg, x + 250, 2600, 7800, 1200, [name], size=26, color=col, bold=True)
        txt(pg, x + 250, 4000, 7800, 800, [sub], size=13, color=GREY)
        txt(pg, x + 250, 5100, 7800, 7200, [text], size=13.5, color=WHITE)
        x += 8700
    txt(pg, 1500, 13500, 25500, 1200, ["Bonus behavior: EIP-6780 verified - apoptosis never relied on selfdestruct. EIP-150 63/64 rule priced into the keeper gas budget since v2.1."], size=14, color=GOLD)

def s_defended():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Defended against: what public ERCs would do to us"], size=30, color=ACCENT, bold=True)
    rows = [
        ("ERC-20 as food", RED, "REJECTED. Fee-on-transfer breaks the per-payer ledger; rebasing breaks cost-basis math (the 4626-on-rebasing-asset incident class); honeypots weaponize approvals. The larder is native ETH only - there is deliberately no token deposit path. Token yield enters ONLY through a 4626 venue."),
        ("ERC-721 / 1155", RED, "ABSENT BY DESIGN. onERC721Received/onERC1155Received are reentrancy doors; the audit verified zero token-callback implementations in the system. Future NFT organs must gate callbacks."),
        ("4626 inflation attack", GOLD, "DEFENDED. First-depositor donation-skew steals later deposits unless countered; our standard-compliant mock carries OZ-style virtual shares AND virtual assets - regression A11 proves: attacker donates 10 ETH, recovers ~0.01; victim loses <1%."),
        ("Approval tokens", GREEN, "N/A SAFE. The cell never places ERC-20 approvals - there is no allowance surface to abuse; a compromised organ can only move the cycle budget it was granted."),
    ]
    y = 2400
    for name, col, text in rows:
        row(pg, y, 2700, 0x1E2C47, line=col)
        txt(pg, 1700, y + 150, 4300, 2400, [name], size=17, color=col, bold=True)
        txt(pg, 6200, y + 130, 20400, 2500, [text], size=13.5, color=WHITE)
        y += 2900

def s_aa():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Account abstraction: the autonomy end-game (aligned, not yet wired)"], size=27, color=ACCENT, bold=True)
    txt(pg, 1500, 2300, 25500, 10600, bullets([
        (0, "EIP-7702 (live since Pectra, May 2025): an EOA-shaped cell handle that runs real contract code at the same address."),
        (0, "ERC-4337 EntryPoint v0.9 (Nov 2025): bundlers submit the cell's intent; PAYMASTERS spend the cell's own food for gas - keepers need no wallet at all, the ultimate self-funding statement."),
        (0, "ERC-7562 canonical validation rules: exactly the discipline our act()/spend() windows already enforce locally (no unbounded state growth in validation paths)."),
        (0, "ERC-7579 / ERC-6900 modular accounts: our WORKER + graftTemplate design IS a module system - mapping organs onto 7579 module registers is a thin adapter, proof the design generalizes."),
        (0, "Audit warning shipped with the plan: a 7702 delegation target is a NEW TRUST ROOT - it must be colony/DAO-governed, never keeper-settable."),
        (0, "EIP-712 + ERC-1271: required the moment we accept signed agent intents (8004 registries themselves mandate both) - flagged in AUDIT.md roadmap."),
    ]), size=17.5, space=11)
    txt(pg, 1500, 13600, 25500, 1000, ["Why not wired in this PR: it needs an L2 deployment target + EntryPoint dependency - next iteration, on Base Sepolia."], size=15, color=GOLD)

def s_findings1():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Audit findings I: the three Highs (all fixed, all regression-proven)"], size=27, color=ACCENT, bold=True)
    rows = [
        ("A1", "Silent organs graftable", "registry accepted any WORKER - the cycle would try act() on modules structurally unable to answer", "ERC-165 gate at _register: WORKER must DECLARE IWorker (try/catch probe for clean rejects)", "A1"),
        ("A3", "Clone-init race", "organelle clones were first-caller-wins: an attacker could pre-bind a clone to a rogue nucleus before the curator's graft installed it", "initialize() is COLONY-only; graftTemplate does clone+bind+register atomically; no path around", "A3"),
        ("A4", "Cycle gas DoS", "an organ's act() had no gas bound - one malignant graft could burn the whole block every single express()", "act{gas: workerGasStipend} + frame-atomic try/catch; default 2M sized to legit worst job", "A4"),
    ]
    y = 2350
    for fid, title, vuln, fix, test in rows:
        row(pg, y, 3400, 0x1E2C47, line=RED)
        txt(pg, 1650, y + 150, 1500, 1000, [fid], size=22, color=RED, bold=True)
        txt(pg, 3200, y + 150, 5900, 3000, [title], size=15, color=WHITE, bold=True)
        txt(pg, 9400, y + 130, 8100, 3200, ["BUG: " + vuln], size=12, color=GREY)
        txt(pg, 17800, y + 130, 8700, 3200, ["FIX: " + fix + "   [regression " + test + "]"], size=12, color=GREEN)
        y += 3600

def s_findings2():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Audit findings II: the bounded-growth family (M/L)"], size=30, color=ACCENT, bold=True)
    rows = [
        ("A5/A6", "Registry size was unbounded -> every cycle's scans grew with it", "cap 24 aux organs; tombstone accounting honest (evict frees slot, re-graft re-spends it)"),
        ("A7", "Golgi packages array grew forever; full scan every cycle", "64 live-package cap + swap-and-pop pruning (length == live count)"),
        ("A8", "Peroxisome flagged list unbounded; scan per detoxification", "32-flag cap; saturation DROPS FLAGS, never reverts a permissionless report()"),
        ("A9", "Ribosome order queue unbounded", "32-pending cap"),
        ("A10", "Keeper aging list grew per distinct keeper", "cap 512; past it, credits stay payable FOREVER (fails safe toward keepers, never seizes)"),
    ]
    y = 2400
    for fid, vuln, fix in rows:
        row(pg, y, 1900, 0x1E2C47, line=GOLD)
        txt(pg, 1700, y + 200, 1600, 1500, [fid], size=17, color=GOLD, bold=True)
        txt(pg, 3600, y + 150, 10800, 1700, [vuln], size=13.5, color=WHITE)
        txt(pg, 14800, y + 150, 11700, 1700, [fix], size=13, color=GREY)
        y += 2050
    txt(pg, 1500, 12800, 25500, 1200, ["Accepted-risk notes (B2-B7) + recommendations (Ownable2Step, slither/forge fuzz pass, adapter audit) live in AUDIT.md §2/§6."], size=14, color=GREY)

def s_learned():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Three lessons the audit earned"], size=34, color=ACCENT, bold=True)
    txt(pg, 1500, 2400, 25500, 1200, ["1.  CAPS MUST FAIL TOWARD THE USER."], size=22, color=GOLD, bold=True)
    txt(pg, 1800, 3300, 25000, 1600, ["The keeper-list cap chose: past 512 entries, forfeiture STOPS (credits stay payable forever) - the bounded version can only do less harm, never more. A cap that silently forfeited newcomers would be a fund-loss bug wearing a gas-fix costume."], size=15, color=WHITE)
    txt(pg, 1500, 5400, 25500, 1200, ["2.  ROUNDING IS AN ORACLE."], size=22, color=GOLD, bold=True)
    txt(pg, 1800, 6300, 25000, 2200, ["v2.2's first 4626 draft reduced cost basis proportional to shares redeemed - which silently RE-DERIVED phantom yield after every harvest and would have over-withdrawn funds belonging to other depositors. The shipped invariant (yield == staked - principal, exact in asset space) is simpler AND provable. Native-ETH vaults must also price shares BEFORE counting the inflow (B1) - preview vs deposit now match."], size=15, color=WHITE)
    txt(pg, 1500, 9100, 25500, 1200, ["3.  BOUNDS INTERACT - TUNE THEM TOGETHER."], size=22, color=GOLD, bold=True)
    txt(pg, 1800, 10000, 25000, 1600, ["Worst-case cycle gas is now aux-cap x stipend (24 x 2M = ~48M): shrink one knob below the other's needs and an organ quietly becomes OrganFailed forever. The docs pair them; the deck pairs them; the monitor should too."], size=15, color=WHITE)

def s_results():
    pg = add_slide(); bg(pg)
    txt(pg, 1500, 700, 25500, 1200, ["Results & the honest ledger"], size=34, color=ACCENT, bold=True)
    stats = [("79", "tests passing", GREEN), ("18", "audit findings", GOLD), ("11", "fixed in code", ACCENT), ("0", "open Highs", RED)]
    x = 1500
    for big, small, col in stats:
        row(pg, 2300, 3000, 0x1E2C47, line=col, x=x, w=5900)
        txt(pg, x, 2500, 5900, 1600, [big], size=40, color=col, bold=True, align="CENTER")
        txt(pg, x + 200, 4200, 5500, 900, [small], size=14, color=WHITE, align="CENTER")
        x += 6500
    txt(pg, 1500, 5900, 25500, 1000, ["Still accepted risk (documented, not fixed):"], size=18, color=WHITE, bold=True)
    txt(pg, 1500, 6900, 25500, 6000, bullets([
        (0, "B2: harvest recipient is owner-set full-gas ETH - malicious only if the owner attacks itself; pull-payments listed as the hardening path."),
        (0, "B3: administer = owner config power over a cell's own organs - consistent with the owner's pre-existing full capital authority; governance organ is the replacement."),
        (0, "B4: digest-vs-claim race is TTL-gated (30d default) - raise TTL where keepers are slow."),
    ]), size=15.5, space=8)
    txt(pg, 1500, 13500, 25500, 1200, ["Next: Ownable2Step, slither + forge-invariant fuzz campaign, ERC-4337/7702 spike on Base Sepolia, then the first REAL venue adapter (audited as its own component)."], size=15, color=GOLD)

s_title(); s_method(); s_adopted(); s_defended(); s_aa(); s_findings1(); s_findings2(); s_learned(); s_results()

try:
    doc.DrawPages.remove(doc.DrawPages.getByIndex(0))
except Exception as e:
    print("note:", e)

out = "/home/orbit9/Work/cellular_autonoma/docs/"
doc.storeToURL("file://" + out + "Celular-Autonoma-v2.2-ERC-Audit.odp", (pv("FilterName", "impress8"),))
doc.storeToURL("file://" + out + "Celular-Autonoma-v2.2-ERC-Audit.pptx", (pv("FilterName", "Impress MS PowerPoint 2007 XML"),))
doc.storeToURL("file://" + out + "Celular-Autonoma-v2.2-ERC-Audit.pdf", (pv("FilterName", "impress_pdf_Export"),))
print("slides:", doc.DrawPages.Count)
doc.close(False)
print("BUILT")
