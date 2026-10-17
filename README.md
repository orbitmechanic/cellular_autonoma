# cellular_autonoma

Experiments in Solidity life: a *cell* built from address-linked smart contracts
(Nucleus, Chloroplast, EnergyStore) that can **self-replicate** on an EVM chain
and whose accumulated capital its colony **root owner can harvest**.

## Two generations in this repo

- `contracts/` — **v1** (Nucleus, Chloroplast, Leucoplast). The original
  experiment. It compiles but its replication loop can't sustain itself (no
  keeper/gas economics, inherited proxy-cost bloat, no harvest path).
- `contracts/v2/` — **v2** reference rewrite (Nucleus, Chloroplast, EnergyStore,
  Colony, ICell) that fixes v1 and adds the missing capital-harvest loop and
  self-funded metabolism. See `DESIGN.md` for the full analysis.
- `contracts/v2/organelles/` — **v2.1** the full organelle cast as optional,
  graftable modules: Mitochondrion (yield/ATP), Ribosome (in-cell module
  translation), GolgiApparatus (scheduled batch payments), Lysosome (waste
  recycling + organ eviction), Peroxisome (toxin screening/quarantine),
  Vacuole (time-locked storage + quarantine custody + turgor), Membrane
  (priced service receptors - the income organ). All run through the
  Chloroplast's `express()` gene-expression cycle with metered, expiring
  spend authorizations; daughters inherit fresh clones of every replicable
  organelle at birth.

## What's here

```
contracts/Nucleus.sol, Chloroplast.sol, Leucoplast.sol   # v1 (original)
contracts/v2/ICell.sol Nucleus.sol EnergyStore.sol       # v2 core organelles
contracts/v2/Chloroplast.sol Colony.sol                  # v2 metabolism + colony
contracts/v2/organelles/                                 # v2.1 optional cast:
    Mitochondrion Ribosome GolgiApparatus Lysosome
    Peroxisome Vacuole Membrane
contracts/mocks/            # MockYieldVault, MockProtein (test world)
test/                       # 3 v1 characterization + 3 v2/v2.1 suites (68 passing)
scripts/gas-study.js        # bloat + cross-chain cost study -> gas-study.json
scripts/build_deck.py       # regenerates the findings deck in docs/
DESIGN.md                   # findings, chain strategy, organelle map, roadmap
docs/                       # 13-slide Impress deck (odp/pptx/pdf)
```

## Run it

```bash
npm install
npx hardhat compile
npx hardhat test          # 68 passing
npm run gas               # per-function gas report
node scripts/gas-study.js # regenerate gas-study.json
```

## TL;DR of the findings

An EVM contract cannot send its own transaction, so "self-replication without
human intervention" really means **economic autonomy**: make it profitable for
anyone (a keeper/bot/agent) to trigger division, and have the cell pay that
trigger from capital it earned. On Ethereum L1 one division costs ~$49, which
kills it; on **Base** (~$0.03) or **Sonic** (~$0.0004) the same cell can pay its
own metabolism and be harvested. v2 implements exactly that, plus harvest, and
fixes v1's per-generation proxy-cost bloat (measured +58% by gen 6 → flat in v2).
