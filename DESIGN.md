# Design & Findings: Celular Autonoma

_A study of self-replicating, capital-harvesting smart-contract "cells" on
EVM chains — what broke in v1, what path actually works, and a working v2
reference implementation._

---

## 1. What the project is

**Celular Autonoma** is an experiment in building a life-like *cell* out of
Solidity contracts that live on an EVM chain. A cell is an address-linked
collection of organelle sub-contracts, each doing a useful job for the
on-chain community, inspired by real biology:

| Organelle | Biological role | Contract role |
|-----------|----------------|---------------|
| Nucleus   | holds identity, DNA | identity + registry of linked modules |
| Chloroplast | makes energy (sugar) | **metabolism + replication**; pays for gas |
| Leucoplast / EnergyStore | stores starch | **capital storage** ("food") |
| Membrane (planned) | controls what enters | funding/withdrawal gateway, per-payer ledger |

The founding goal: **a collection of smart contracts that can self-replicate
on-chain without human intervention**, and whose accumulated capital the owner
of the colony's root deployment address can **harvest** on demand — "or why
bother?".

---

## 2. The hard constraint that v1 ran into

An EVM contract **cannot send a transaction**. Only an externally owned
account (EOA) — or a smart-account relayer — pays gas and initiates execution.
So a cell cannot literally "decide" to divide: something external must call
`replicate()` and front the gas. On Ethereum mainnet one division costs
**tens of dollars**, and a cell that can't reliably *earn* more than it spends
on gas dies. This — not a coding bug — is why the v1 colony stalled.

There are exactly three ways to relax this constraint:

1. **Move to cheap execution** (L2 / near-free chains) so a division costs
   cents or fractions of a cent.
2. **Make triggering the cell profitable for someone else** — the cell pays a
   *keeper* out of its own earned capital, so keepers/agents/bots divide it
   for the fee. This is **economic autonomy**: the cell still can't send the
   tx, but it always pays its own bills, so no goodwill or human subsidy is
   ever required.
3. **Smart-account / ERC-4337 relayers** (the production-grade version of
   #2) where a bundler submits the transaction and the cell's own token
   balance pays the gas via a paymaster.

v1 attempted none of these fully. v2 implements **#2 and #1** directly.

---

## 3. What actually broke in v1 (verified by tests + gas study)

The v1 code compiles, but its replication loop cannot sustain itself. Each
failure below is reproduced by an executable characterization test
(`test/Chloroplast.test.js`, `test/Leucoplast.test.js`, `test/Nucleus.test.js`).

1. **Dead capital, no gas economy.** `replicate()` withdraws a
   `replicationCostEstimate` into the Chloroplast and then never spends it.
   The keeper who actually sent the transaction paid 100% of the gas from
   their own wallet. There is no reimbursement path, so nobody has an
   incentive to divide the cell. → **v2 fix: pull-payment keeper reimbursement
   funded from the cell's own food.**

2. **Inherited proxy-depth gas bloat.** v1 clones *live instances*
   (`leucoplast.clone()`, `nucleus.clone()`-of-clone). Each generation's
   organelle is a proxy whose implementation is the *previous* instance, so
   every call adds another `DELEGATECALL`. Measured cost of a trivial
   `identity()` read by lineage generation:
   `23,997 → 26,675 → 29,467 → 32,281 → 34,980 → 37,971 gas` (**+58% by gen
   6, and still climbing**). A colony that self-replicates indefinitely gets
   *more expensive* with each generation — the opposite of a healthy organism.
   → **v2 fix: always clone from the immutable TEMPLATE, never an instance.
   Measured `getBalance()` call cost across 6 generations: 23,882 every time —
   flat.**

3. **Identity-string bloat.** v1 names each clone `"Cell1 copy"`, `"Cell1 copy
   copy"`, … measured length by generation: `10, 15, 20, 25, 30, 35` bytes,
   growing forever, increasing calldata and storage cost. → **v2 fix: bounded
   numeric serials (`cell#N`) + generation number.**

4. **Daughter inherits the mother's metabolism.** After `replicate()`, the
   child's registered Chloroplast is the *mother's* instance, still wired to
   the *mother's* Leucoplast. The daughter's own cloned Leucoplast is
   orphaned. Daughters therefore cannot autonomously divide. → **v2 fix: the
   Colony assembles each daughter with its own wired nucleus + energy +
   metabolism.**

5. **Broken membership gate.** `Leucoplast.onlyCellMember` calls
   `getOrganelleName(msg.sender)`, which *reverts* for outsiders instead of
   returning empty — so the modifier's intended "Cannot withdraw" branch is
   unreachable, and **any** registered organelle (even the Nucleus, even an
   EOA the parent mis-registered) can withdraw up to half the cell's funds to
   any address. No role separation. → **v2 fix: explicit capability `Role`s
   with a non-reverting `getRole()`; only METABOLISM or the Colony move funds.**

6. **No harvest.** v1 has no path for accumulated capital to reach the colony
   root deployer. The whole point ("capital harvestable or why bother") was
   missing. → **v2 fix: birth tithes + treasury fees + a tree-walking
   `harvestColony()` that pays the owner, while never stranding keeper
   credits.**

7. **Unlimited division.** No cooldown, no generation cap, no reserve floor:
   a funded cell would replicate as fast as blocks allow forever. → **v2 fix:
   `minBirthInterval`, `maxGeneration`, `minReserve`, all colony-tunable.**

Also: the v1 test suite was written for ethers v5 APIs but the project pinned
hardhat-toolbox v5 (ethers **v6**), so every test errored at the setup hook
(0 passing). Ported to v6 and repurposed as *characterization tests*.

---

## 4. The recommended path

### Chain choice — where this actually works

A full v2 division ≈ **1.1 M gas**. Projected USD cost of one self-replication
across candidate chains:

| Chain | v1 cost/division | v2 cost/division |
|-------|-----------------:|-----------------:|
| Ethereum L1 | $82.03 | $48.61 |
| Arbitrum One | $0.547 | $0.324 |
| OP Mainnet | $0.273 | $0.162 |
| **Base (L2)** | $0.0547 | **$0.0324** |
| **Sonic** | $0.000638 | **$0.000378** |
| Polygon PoS | $0.0273 | $0.0162 |

**Recommendation: launch on Base or Sonic, not L1.**
- **Sonic** is EVM-equivalent and ~fractions of a cent per division — exactly
  the "Solidity-adjacent chain where transactions are nearly free" the brief
  hypothesizes. Best raw economics for near-free self-replication.
- **Base** is the pragmatic choice: cheap (~3¢/division), an enormous existing
  ecosystem of DeFi protocols, AI-agent activity, and ERC-4337 paymasters to
  sell metabolism services to and earn "food" from.
- The **EVM-equivalent** property of both means the same contracts deploy
  unchanged. Ship the same bytecode to a testnet today, Base + Sonic next.

v2's keeper reimbursement is also gas-priced on-chain (`birthGasBudget`,
`keeperStipend`, capped by `maxRefundCap`/`maxRefundBps`), so a single Colony
deploy is profitable for keepers on whichever chain it lives.

### Autonomy model — "economically autonomous", not literally autonomous

Because a contract cannot self-initiate, target the achievable property:
**anyone can profitably trigger the cell, and the cell always pays its own
bills from capital it earned.** On a cheap chain, keepers/agents/AI bots divide
the colony for the reimbursement, and the root owner harvests the surplus. That
is the closest realizable form of "self-replication without human intervention".
The production upgrade is ERC-4337: make each Chloroplast a smart account with a
paymaster so a bundler (not an EOA) pays gas and the cell settles in tokens.

---

## 5. What a cell is good for (metabolism that earns capital)

A cell must *earn* more food than it burns paying its metabolism, or it dies.
Plausible revenue for an autonomous on-chain process (v2 ships the `creditedBy`
per-payer ledger and `graft`/RESERVE slots these plug into):

- **Keeper-for-hire**: run as a Chainlink Automation / Gelato relayer; other
  protocols pay it to fire their `performUpkeep`.
- **Yield metabolism (true photosynthesis)**: idle food auto-deposited into
  Aave / Morpho / LSTs on Base; yield = energy income. This is the biggest,
  most "alive" revenue source and the natural RESERVE organelle.
- **Service endpoints sold to AI agents**: rate-limited on-chain primitives
  (identity, escrow, signed-data attestation, coordination clocks) that bots
  pay per call with; the per-payer ledger meters them.
- **Colony compute coordination**: cells hold/settle payments for multi-agent
  jobs.
- **Storage/registry rent**: long-lived named slots other contracts pay to use.

### Multicellular organisms

V2 adds a **Colony** — a tree of related cells sharing an owner and templates,
with capital flowing up (tithes + harvest). Organs form when cells specialize:

- **Division of labour**: graft different RESERVE/service organelles onto
  sibling cells so one is a yield-maker, one a relayer, one an escrow node.
- **Shared genome, cheap clones**: template clones mean a 1000-cell colony
  costs ~1.1 M gas/cell, no per-generation decay — colony growth is linear,
  not compounding.
- **Apoptosis**: an owner (or a governance organelle later) can retire a sick
  cell and reclaim its capital, keeping the organism healthy.
- **Ecosystem integration**: the Colony treasury and per-cell Membranes are
  natural counter-parties to existing protocols, bots, and humans — the cell
  earns by being useful infrastructure, and harvests that income to its root.

---

## 6. v2 reference implementation (in this repo, `contracts/v2/`)

| Contract | Responsibility |
|----------|----------------|
| `ICell.sol` | shared `Role`s + organelle/energy interfaces |
| `Nucleus.sol` | identity (serial + generation), registry with roles, lineage (parent + children) |
| `EnergyStore.sol` | food; per-payer ledger; pull-payment keeper credits; `remitUp` tithe |
| `Chloroplast.sol` | gated `replicate()` (cooldown, gen-cap, reserve) + keeper reimbursement + `canReplicate()` view |
| `Colony.sol` | the one assembler that may wire cells; `plantRoot`, `birth`, `harvestOne`, gas-bounded `harvestColony`, `graft`, `apoptosis`, treasury |

### v2.1: the full organelle cast (`contracts/v2/organelles/`)

Cell theory mapped to contract capabilities. Every organelle is an **optional,
graftable module**: a template clone registered in the cell's Nucleus with a
capability `Role`. The Colony's `graftTemplate` gives a living cell new organs
(one-shot clone + bind + register); the **Ribosome automates** the same loop.

| Organelle | Biology | Contract job | Role |
|-----------|---------|--------------|------|
| `Mitochondrion.sol` | respiration → ATP | deploys surplus capital into an external yield venue (Aave-style adapter), harvests accrued ATP as food, breathes out when the cell needs liquidity | WORKER |
| `Ribosome.sol` | mRNA → protein | translates registered "gene" templates into fresh clone products; the in-cell evolution engine (order → translate → graft) | WORKER |
| `GolgiApparatus.sol` | packages, tags, ships | scheduled, memo-tagged batch payments ("exocytosis"); ships a batch atomically only when this cycle's budget covers it whole | WORKER |
| `Lysosome.sol` | digests waste, autophagy | reclaims expired keeper credits into the cell, executes condemned-organelle eviction, sweeps dust home | WORKER |
| `Peroxisome.sol` | detoxification | community-reported agents (quorum-gated, non-enriching) get flagged; flagged revenue is sequestered; the Membrane refuses flagged agents | WORKER |
| `Vacuole.sol` | storage, turgor, isolates toxins | time-locked tranches that flow back to the cell when mature; quarantine custody (jury-released only); exposes `pressure()` as the cell's turgor metric | WORKER |
| `Membrane.sol` | selective permeability, receptors | the income organ: priced receptor bindings for agents/protocols/bots, per-payer metering, rate windows, overpay refund, shield-checked admission; tips forward to the cell | OTHER |

**Gene expression (`Chloroplast.express()`).** Optional organelles never hold
treasury keys. Each cycle, the metabolism opens a fresh cycle nonce, hands
every WORKER a metered, expiring `spend` authorization (min of 25% of the
cell's remaining discretionary food and a per-worker ceiling), and calls its
`act(budget)`. Unspent authorization dies with the cycle. A failing organ is
skipped (`OrganFailed`) - one damaged module cannot brick the cell. The
keeper who triggers the cycle is reimbursed exactly like mitosis, so the
daily work of the organism is self-funding too.

**Capability lives in the registry.** `act()` only works for clones the cell
currently registers as WORKER; the lysosome's "condemn → unregister" evicts a
module's power instantly with no state to clean up. Daughter cells are born
with their own fresh clones of every replicable organelle (templates cloned
at birth, `BirthDefect` emitted if an organ refuses binding) - **acquired
state is not inherited** (the daughter's mitochondrion must be configured
anew): exactly right for an experiment about evolution, and where a future
"epigenetics" module can choose what a daughter keeps.

Security posture: templates bound immutably to their Colony, `_disableInitializers`
on implementations, role-gated fund movement, CEI ordering, pull-payments, and a
keeper-credit reserve that harvest deliberately never strands. See the PR review
notes for the specific inline justifications.

### Tests

`npx hardhat test` → **68 passing** (v2.1: 29 organelle tests + full-organism
end-to-end; v2.0: 39). Three v1 characterization suites (prove the flaws are
real), two v2 suites (cell mechanics + economics), one v2.1 suite (organelle
cast: income, respiration, shipping, recycling, quarantine, translation,
expression resilience, inheritance). `npm run gas` prints per-function gas.
`scripts/gas-study.js` regenerates `gas-study.json` (the bloat and cross-chain
tables above).

---

## 7. Roadmap

1. Deploy Colony to a Base Sepolia testnet; publish keeper-reimbursement params.
2. ~~Build the Membrane organelle (fee-taking gateway) + a yield
   RESERVE module (the photosynthesizer).~~ **Done in v2.1** (`Membrane`,
   `Mitochondrion`); next step is the real Base adapter (Aave v3 `supply`/
   `withdraw` behind `IYield`) instead of `MockYieldVault`.
3. ERC-4337 wrapper so cells pay gas in tokens via a paymaster (full autonomy
   upgrade).
4. Governance organelle for owner-less colonies (harvest recipient becomes a
   DAO), reputation scoring for which cells to propagate.
5. Turntable: a colony that runs entirely on its own earned income for N days,
   measured by harvest-to-root vs total gas burned.
6. Epigenetics: an expression policy module deciding which replicable
   organelles daughters inherit configured - differentiation from a common
   genome.
