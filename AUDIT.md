# Security & Vulnerability Audit — Celular Autonoma v2.2

_A systematic audit of the entire autonomous-cell system (v2.0 core + v2.1
organelle cast + v2.2 ERC refactor), with an ERC-alignment matrix. Findings
are recorded even when fixed or accepted — an audit you can read is worth
more than an audit that only says "ship it"._

**Scope:** `contracts/v2/` (ICell, IERCs, Nucleus, EnergyStore, Chloroplast,
Colony) + `contracts/v2/organelles/` (Organelle base, Mitochondrion,
Ribosome, GolgiApparatus, Lysosome, Peroxisome, Vacuole, Membrane) +
`contracts/mocks/`. v1 (`contracts/*.sol`) is grandfathered documentation of
failure modes (#12-#17), not in scope.

**Method:** manual line-by-line review of every state-changing function
(authority, checks-effects-interactions, value-flow, revert-mode), invariant
enumeration, adversarial thought experiments per actor (stranger EOA, botched
graft, malignant grafted organ, malicious keeper, dishonest colony owner,
yield-venue failure), plus executable regression tests
(`test/v2.2-audit.test.js`, A1-A11) proving each fix. **79 tests passing.**

---

## 1. System invariants (what must always hold)

| # | Invariant | Enforced by | Status |
|---|-----------|-------------|--------|
| I1 | Capital leaves a cell only to: its own daughters (endowment/tithe), its own organelles within an authorization, treasury fees, or the owner's harvest recipient | EnergyStore `withdraw`/`spend`/`remitUp` authority matrix | verified by tests |
| I2 | ETH promised to keepers (`outstandingCredits`) is never swept by harvest, never spent by organs (mitosis included) | `available() = balance - outstandingCredits` gate on every outflow path | verified |
| I3 | A registered organelle's power dies the instant it leaves the registry (no local "am I enabled" flags) | `act()`/`spend()` re-check `Nucleus.getRole`/`hasRole` live | verified |
| I4 | No organelle can move more than `min(perWorkerCeiling, workerBudgetBps of remaining discretionary food)` per cycle, and only inside the expression window | nonce-scoped ceilings + `cycleOpen` window | verified (A4, ceiling tests) |
| I5 | Every organ-to-organ and colony-to-organ clone is one DELEGATECALL from its implementation (no proxy-of-proxy lineage) | template-only cloning in `Colony.birth`/`graftTemplate` | verified flat (gas study) |
| I6 | All bounded lists are O(1)-capped (registry, keeper aging list, Golgi, Ribosome, Peroxisome) so no cycle cost grows without limit | v2.2 bounds (below) | verified (A5-A9) |
| I7 | State-changing initialization can be done exactly once per clone, only by the Colony that owns the template | `initializer` + `msg.sender == COLONY` | verified (A3) |

## 2. Findings register

Severity: **H**igh = funds/availability at risk pre-fix; **M**edium =
availability or integrity under unusual conditions; **L**ow/Info = hygiene,
documented trust.

| ID | Sev | Finding | Disposition |
|----|-----|---------|-------------|
| A1 | **H** | v2.1 registry accepted any address as `WORKER`; metabolism would call `act()` on silent modules → every `OrganFailed` catch hides graft-time nonsense | **FIXED v2.2**: ERC-165 registry gate in `Nucleus._register` (try/catch for clean revert): WORKER grafts must declare `type(IWorker).interfaceId` (A1) |
| A2 | M | `Membrane.attachShield` accepted any address as the toxin shield; a shield without `screen()` bricks all binds or silently screens nobody | **FIXED v2.2**: same ERC-165 gate, `IPeroxisome` id required (A2) |
| A3 | **H** | Clone-init race: organelle clones were initialized by first-caller-wins; an attacker could observe a template, clone it, and bind it to a rogue "nucleus" before the curator's graft — installing a wired-wrong organ into a cell | **FIXED v2.2**: `Organelle.initialize` is colony-only (I7); graftTemplate performs the clone+init atomically from the Colony (A3) |
| A4 | **H** | Unbounded per-organ execution: a grafted-but-malicious (or merely expensive) organ's `act()` could burn the whole block gas within `express()` — a per-cell DoS that also starves its siblings every cycle | **FIXED v2.2**: `act{gas: workerGasStipend}()` + try/catch: the organ gets its allotment and nothing more; failed state rolls back inside its own frame; default 2M gas covers the largest bounded job (a full 64-package Golgi dispatch) with margin (A4, A7) |
| A5 | M | Unbounded registry growth (`graftTemplate` × ∞) made `workerList()`, `getOrganelleByRole`, `hasRole` scans — i.e. EVERY cycle — grow without limit | **FIXED v2.2**: `Colony.maxAuxiliaryOrganelles` (default 24) enforced at `_register`, accounting includes tombstone reuse; eviction frees slots (A5, A6) |
| A6 | M | `unregisterAux` left role intact on tombstones → re-grafting an evicted name bypassed the aux accounting | **FIXED v2.2**: tombstone sets `Role.NONE` + decrements `auxCount`; occupied-slot logic distinguishes replace vs re-graft (A6) |
| A7 | M | Golgi: `packages[]` grew forever; dispatched entries still scanned each cycle; `pendingTotal` bookkeeping-only; queue depth unbounded | **FIXED v2.2**: `MAX_LIVE_PACKAGES=64` + swap-and-pop pruning on dispatch/cancel (array length == live count; O(cap) scan) (A7) |
| A8 | M | Peroxisome: `report()` was permissionless (good) but `flaggedList` was not (bad) — unlimited flagged agents made every detoxification scan unbounded | **FIXED v2.2**: `MAX_FLAGGED=32`; saturation emits `ShieldSaturated` and DROPS the flag rather than reverting a permissionless call (A8b) |
| A9 | L | Ribosome order queue unbounded (gas profile of `act` grew with backlog) | **FIXED v2.2**: `MAX_PENDING_ORDERS=32` (A9) |
| A10 | L | `EnergyStore._creditedList` grew per distinct keeper (unbounded digest scan) | **FIXED v2.2**: `MAX_AGING_KEEPERS=512`; beyond the cap credits stay payable forever (fails safe toward keepers, never seizes) (A10) |
| A11 | M | The v2.1 yield venue was bespoke and did not model the ERC-4626 donation/inflation attack — a real-venue integration would have discovered it late | **REFACTORED v2.2**: Mitochondrion speaks **ERC-4626** (deposit/withdraw/preview/max* + shares); mock now implements the OZ-style **virtual shares AND virtual assets** offsets; A11 is the executable donation-attack regression (victim loses <1%, attacker loses ~99.9% of the donation) |
| B1 | Info | Native-ETH deposit preview/deposit consistency: ERC-4626 `previewDeposit` for a native-ETH vault must price BEFORE the inflow (OZ gets this "for free" by pulling ERC20 after the math). Mock v1 got it wrong; fixed to price against `balance - msg.value` | FIXED during A11 |
| B2 | Info | `withdraw`/`remitUp` use full-gas `Address.sendValue` — recipients are always either our own receive-only proxies or owner-set addresses; a malicious CONTRACT `harvestRecipient` could re-enter `Colony` mid-sweep. Mitigated: CEI holds per node, and only the owner can move the recipient — self-inflicted only | **DOCUMENTED, accepted**: owner is the colony's root authority (harvest-100% is legal via setParams anyway); hardening path = pull-based harvest |
| B3 | Info | `Colony.administer` gives the owner arbitrary call power over a cell's own organelles — consistent with pre-existing owner capital authority (harvestBps→100%, apoptosis sweeps); target MUST be a registered organelle | **ACCEPTED**: documented trust; roadmap replaces with governance organelle (#issue) |
| B4 | Info | Keeper credit forfeiture (`digestExpiredCredits`, TTL default 30d) is *callable by any WORKER*: a hostile organ could aggressively digest fresh-but-slightly-stale credits | **NOTED**: TTL floor is the colony's knob (default 30 days); an organ digesting credits younger than TTL reverts on the age check; claim-before-digest race costs the digestor gas and pays the cell. Low practical risk; raise TTL where keepers are slow |
| B5 | L | Ownable ownership transfer is single-step (`transferOwnership`) — a mistyped new owner hard-locks the colony | **RECOMMENDED**: adopt Ownable2Step before mainnet (1-line swap) |
| B6 | L | `Vacuole.lock` casts `msg.value` to uint112 (~7.9e28 ETH) — safe but silent on absurd inputs | **NOTED**: add require if exotic supply chains appear |
| B7 | Info | Mocks are mocks: `MockERC4626Vault` has no operators and `drain()` is unguarded BY DESIGN (insolvency drills). Nothing in `contracts/mocks/` may ship | **DOCUMENTED** |

## 3. ERC/EIP alignment matrix

**ADOPTED (interface or behavior now conforms):**

| ERC/EIP | Status | What changed here |
|---|---|---|
| **ERC-165** (Final) | adopted | Registry gate: WORKER grafts must declare `IWorker`; Membrane shields must declare `IPeroxisome`. Replaces runtime guesswork with compile-time-declared conformance (A1, A2) |
| **ERC-4626** (Final) | adopted | `Mitochondrion` speaks pure ERC-4626; venue becomes a swappable substrate (Aave v3, Morpho, LST wrappers) with the donation-attack defense demonstrated in-repo (A11) |
| **ERC-8004** (Draft; mainnet-live Jan 2026) | aligned | `Membrane` gains the discovery surface an 8004 Identity registration file describes: `agentName`, `registrationURI`, `setAgentIdentity`, `supportsInterface(IMembrane8004)`; cells remain price-taking service providers in the agent economy |
| **EIP-6780** (selfdestruct deprecated) | verified | Apoptosis never relied on code deletion — it marks-dead + sweeps; confirmed in review |
| **EIP-2929/3529, EIP-150** | designed around | Keeper refunds budgeted per chain (`birthGasBudget`) because billed gas ≠ observable gas (63/64 rule); warm/cold costs bounded by the caps in section 2 |
| **EIP-712 / ERC-1271** | roadmap | No signature verification exists yet — when added (session keys, off-chain agent auth), MUST use EIP-712 typed hashes + ERC-1271 for contract agents (the EIP-8004 registries themselves require it) |

**DEFENDED AGAINST (explicit rejections with rationale):**

| ERC | Hazard | Our posture |
|---|---|---|
| **ERC-20 as food** | fee-on-transfer breaks `creditedBy` accounting; rebasing tokens break `principal`/basis math (the classic ERC-4626-with-UST incident class); honeypot approvals drain | The larder is **native ETH only** — there is deliberately no token deposit path. Token income goes through a venue the Mitochondrion prices via 4626 `convertToAssets`, never raw balances. Revisit only with per-token risk config |
| **ERC-721/1155 receiving** | `onERC721Received`/`onERC1155Received` callbacks are reentrancy doors | No token callbacks implemented anywhere in the system (verified); future NFT organs must gate + not re-enter treasury |
| **ERC-4626 inflation attack** | first-depositor donation skew steals later deposits | Virtual shares AND virtual assets (OZ offsets) in the standard-compliant mock + regression A11 |
| **ERC-5202 / proxy-with-immutable-args (EIP-6939)** | none — optimization | NOTED for v2.3: bind `nucleus` as clone-time immutable args → saves one SLOAD per organ call and makes A3-class bugs structurally impossible |

**PLANNED (the autonomy end-game, from roadmap issue #13):**
**ERC-4337 v0.9 + EIP-7702**: cells as first-class senders — the Chloroplast
delegated via 7702 to an ERC-7579-style account with a paymaster spending the
cell's own food, subject to ERC-7562 mempool-validation rules. Audit note:
any 7702 delegation target is a NEW trust root — it must be governed by the
colony (or a DAO organ), never settable per-cell by a keeper.

## 4. Per-contract notes

- **Nucleus**: storage-only mutations behind registry gates; `_register` is
  the single choke point (role checks, aux accounting, ERC-165 probe with
  try/catch); `unregisterAux` protects core roles; views bounded by aux cap.
- **EnergyStore**: authority matrix (METABOLISM/COLONY vs WORKER-with-
  ceiling-and-window vs self-service claim) closed under review; the
  keeper-reserve `available()` gate is on EVERY value-out path including
  organ spends; digest rotation cursor prevents starvation.
- **Chloroplast**: replicate and express share the reimbursement helper;
  per-organ gas stipend + catch verified; endCycle cannot stick open
  (frame-atomic); the only unbounded thing left is `workers × stipend` gas
  per cycle — which aux caps bound at 24 × 2M worst case (a tunable).
- **Colony**: birth wires daughters from templates, initializes each organ
  clone (BirthDefect on failure), pulls only from the parent's own energy;
  harvest honors keeper reserves and is gas-bounded by page; administer/
  graftTemplate owner-gated (B3); treasury holds only birth fees.
- **Mitochondrion**: 4626-aligned; invariant `yield == staked - principal`
  exact in asset space; venue insolvency degrades gracefully (maxWithdraw
  clamp → partial harvest, no revert); float floor prevents organ locking
  the cell out of its own liquidity.
- **Membrane**: values always forwarded (holds nothing); overpaid fees
  refunded; rate windows bound per-agent griefing; shield-checked admission.
- **Golgi**: holds zero at rest outside an in-progress dispatch; batch
  atomicity is a feature (no partial payroll) and the prune keeps it bounded.
- **Lysosome / Peroxisome / Vacuole / Ribosome**: all pure-function of
  inputs + registry state; every scan bounded; only Colony releases
  quarantine; eviction and digest both fail safe toward the cell/keepers.

## 5. Test evidence

`test/v2.2-audit.test.js`: A1-A11 executable regressions (each maps to a
finding ID). Full suite: **79 passing** covering v1 characterization, v2.0
mechanics + economics, v2.1 cast behaviors, v2.2 gates/bounds/4626 attack.

## 6. Recommendations (priority order)

1. Before testnet: swap Ownable → Ownable2Step (B5).
2. Testnet run with a REAL ERC-4626 venue (Morpho vault or a canonical
   ERC4626 wrapper) — the substrate, not the mock.
3. ERC-4337/7702 autonomy spike (planned, section 3).
4. EIP-6939/OZ cloneWithImmutableArgs binding of `nucleus` at clone time.
5. Run `slither` + a forge-invariant campaign on top of the A-tests for
   fuzz-level assurance.
6. Epigenetics organ (governed per-lineage inheritance) — turns B3/B4
   owner-trust into contract-verified policy.


---

## 7. v2.3 addendum - the Adipocyte (fat cells)

| ID | Sev | Finding / note | Disposition |
|----|-----|----------------|-------------|
| C1 | Info | The user-proposed mechanism (deploy fat -> selfdestruct dear) is DEAD under EIP-3529 (refund removal) + EIP-6780 (code persists). Shipping it anyway would silently fail. | IMPLEMENTED the surviving weaker form: inflate/render of storage slots; documented loudly in the contract header and DESIGN.md 6a |
| C2 | M | Blubber is a WASTING ASSET: EIP-3298 (scheduled) removes the last storage-clear refund. A treasury booked at blubber would overstate assets when the fork lands. | Policy: blubber is income-diversification + keeper-subsidy, never treasury; `blubberValue()` marks-to-market with basefee; rent income (park) is the durable business either way |
| C3 | L | Refunds accrue to the TX SENDER, not the contract: the cell cannot pocket its own discount. | By design in the organism: fat is spent to subsidize keepers when gas is dear (buying metabolism reliability exactly when it is scarce); the A-test proves the 1/5-cap billing signature |
| C4 | L | Inflate loop is op-capped (MAX_OPS_PER_CYCLE=64) and array-capped (maxSlots, default 0 = inert) | verified - capacity-full cycle must not revert the organism (tested) |
| C5 | L | `park` griefing: anyone may pay rent to grow the array | bounded by maxSlots + rentWei; the cell only profits |
| C6 | Info | basefee==0 (some L2s) skipped both legs - the organ correctly goes passive where no volatility exists | tested by construction (dead-band test) |
