// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Organelle} from "./Organelle.sol";
import {INucleus, IEnergyStore, IWorker} from "../ICell.sol";
import {IERC165} from "../IERCs.sol";

/**
 * @title Adipocyte
 * @dev The FAT CELL: stores gas value on-chain as deliberately "expensive
 *      state" and renders it back as gas discounts when gas is dear.
 *
 * The biology: adipocytes hoard energy for scarcity. The mechanism, under
 * post-London EVM economics (EIP-3529):
 *   - INFLATE: write NON-ZERO to a storage slot costs 22,100 gas
 *     (20,000 set + 2,100 cold access). Done when basefee is low.
 *   - RENDER: clear that slot back to zero costs 2,900 and refunds 4,800
 *     (net -1,788 for the caller's transaction), capped at 1/5 of the
 *     transaction's gas used. Done when basefee is high: every keeper
 *     who bundles a render() into their real work (a replicate, a
 *     liquidation, any batch) pays materially less.
 *   - The refund accrues to the TRANSACTION SENDER - the organism spends
 *     blubber to SUBSIDIZE its metabolizers exactly when metabolism is
 *     expensive, buying keeper attention where it needs it.
 *
 * What this EIP-world does NOT allow (and the deck says so plainly):
 *   - the pre-3529 fat CONTRACT trick (deploy huge, SELFDESTRUCT for the
 *     24k refund) is DEAD: the selfdestruct refund is gone and EIP-6780
 *     keeps the code/contract alive outside same-creation deletes.
 *   - gas TOKENS (mint-when-cheap/burn-when-dear via this same tx pairing
 *     loophole) are dead by construction: a refund can only ever reprice
 *     gas already spent in the same transaction on the same slot.
 *   - EIP-3298 is scheduled to remove even the storage-clear refund.
 *     Blubber is a WASTING ASSET: value it with an expiry, never as a
 *     treasury. The archive business (park) survives its death anyway.
 *
 * The rent business makes the fat free: `park(data)` is a paid service -
 * agents/protocols pay to have 32 bytes held by an autonomous organism
 * (proof-of-inclusion archive, commitment custody). Rent flows to the
 * cell as food; the bytes are the blubber; the future refund is the
 * cell's hedge. Income first, speculation second.
 *
 * Policy fields are cell-core set; the organ only ever MOVES its own
 * blubber - it never touches treasury funds (no spend() use at all:
 * inflation is a GAS cost reimbursed to the keeper like any organ work).
 */
contract Adipocyte is Organelle {
    bytes32[] private _blubber; // each entry: non-zero = 4,800-gas option
    uint256 public renderCursor; // render walks forward; filled() counts live slots
    uint256 public renderedTotal;
    uint256 public inflatedTotal;
    uint256 public rentEarned;

    // policy (cell core)
    uint96 public rentWei; // price per parked slot (covers its inflate gas + margin)
    uint256 public maxSlots; // array bound (0 = inert until configured)
    uint256 public inflateBasefeeCeiling; // only fatten at/below this wei gas price
    uint256 public renderBasefeeFloor; // only render at/above this wei gas price
    uint256 public renderPerCycle; // ops per expression cycle

    uint256 public constant INFLATE_GAS_PER_SLOT = 22_100; // 20k set + 2.1k cold
    uint256 public constant RENDER_REFUND_GAS = 4_800; // per cleared slot (EIP-3529)
    uint256 public constant MAX_OPS_PER_CYCLE = 64; // inflate ops bound

    event Parked(address indexed tenant, bytes32 indexed data, uint256 rentPaid);
    event Inflated(uint256 slots, uint256 gasBought);
    event Rendered(address indexed renderBy, uint256 slots, uint256 refundGasCeiling);

    constructor(address colony_) Organelle(colony_) {}

    function configure(
        uint96 rentWei_,
        uint256 maxSlots_,
        uint256 inflateCeiling_,
        uint256 renderFloor_,
        uint256 renderPerCycle_
    ) external onlyCellCore {
        require(rentWei_ > 0, "Adipocyte: rent must be positive");
        require(renderFloor_ > inflateCeiling_, "Adipocyte: floor must exceed ceiling"); // no buy-high-sell-low policy
        rentWei = rentWei_;
        maxSlots = maxSlots_;
        inflateBasefeeCeiling = inflateCeiling_;
        renderBasefeeFloor = renderFloor_;
        renderPerCycle = renderPerCycle_;
    }

    // ---- the archive business (income) ----

    /// @dev Hold a tenant's 32 bytes for `rentWei` or more. The payment is
    ///      forwarded to the cell's EnergyStore as food (attributed to the
    ///      tenant there via the Fed ledger); the data is the blubber.
    function park(bytes32 data) external payable {
        require(data != bytes32(0), "Adipocyte: zero data cannot be fattened");
        require(msg.value >= rentWei, "Adipocyte: rent too low");
        require(_blubber.length < maxSlots, "Adipocyte: body capacity");
        _blubber.push(data);
        rentEarned += msg.value;
        Address.sendValue(payable(address(_store())), msg.value);
        emit Parked(msg.sender, data, msg.value);
    }

    // ---- the gas-option body (speculation, bounded) ----

    /// @dev Expression-cycle work: fatten cheap, render dear, idle in
    ///      between. No treasury funds move; the cell's cost is exactly
    ///      the keeper reimbursement for the gas burned executing this.
    function act(uint256 budgetWei) external {
        _requireActivation();
        if (maxSlots == 0) return; // inert until a curator sets a body plan
        if (block.basefee == 0) {
            // near-free chains (some L2s) leave no volatility to arbitrage:
            // blubber buys nothing here; skip both legs
            emit Activated(budgetWei);
            return;
        }
        if (block.basefee <= inflateBasefeeCeiling) {
            // buy as many 22.1k-gas slots as the cycle budget at current
            // basefee can cover (this cell's ETH pays keepers via credit,
            // never this organ's own gas directly)
            uint256 room = maxSlots - filled();
            uint256 byBudget = budgetWei / (INFLATE_GAS_PER_SLOT * block.basefee);
            uint256 ops = byBudget < MAX_OPS_PER_CYCLE ? byBudget : MAX_OPS_PER_CYCLE;
            if (ops > room) ops = room;
            for (uint256 i = 0; i < ops; i++) {
                _blubber.push(keccak256(abi.encodePacked(address(this), inflatedTotal + i)));
            }
            if (ops > 0) {
                inflatedTotal += ops;
                emit Inflated(ops, ops * INFLATE_GAS_PER_SLOT);
            }
        } else if (block.basefee >= renderBasefeeFloor) {
            uint256 cap = renderPerCycle < MAX_OPS_PER_CYCLE ? renderPerCycle : MAX_OPS_PER_CYCLE;
            uint256 done = 0;
            while (done < cap && renderCursor < _blubber.length) {
                if (_blubber[renderCursor] != bytes32(0)) {
                    delete _blubber[renderCursor]; // non-zero -> zero: 2,900 cost, 4,800 refund
                }
                renderCursor++;
                done++;
            }
            if (done > 0) {
                renderedTotal += done;
                emit Rendered(msg.sender, done, done * RENDER_REFUND_GAS);
            }
        }
        emit Activated(budgetWei);
    }

    /// @dev A keeper may render blubber INTO ANY transaction they send -
    ///      bundling is how the discount reaches real work (replicate,
    ///      express, liquidations...). Policy floor enforced.
    function render(uint256 maxSlots_) external {
        require(block.basefee >= renderBasefeeFloor, "Adipocyte: gas too cheap to burn fat");
        uint256 cap = maxSlots_ > MAX_OPS_PER_CYCLE ? MAX_OPS_PER_CYCLE : maxSlots_;
        uint256 done = 0;
        while (done < cap && renderCursor < _blubber.length) {
            if (_blubber[renderCursor] != bytes32(0)) {
                delete _blubber[renderCursor];
            }
            renderCursor++;
            done++;
        }
        renderedTotal += done;
        emit Rendered(msg.sender, done, done * RENDER_REFUND_GAS);
    }

    /// @dev Recompute cursor against the array head after external writes.
    function resetCursor() external onlyCellCore {
        renderCursor = 0;
    }

    // ---- body-composition views ----

    function filled() public view returns (uint256) {
        return _blubber.length - renderCursor;
    }

    function stored() external view returns (uint256) {
        return _blubber.length;
    }

    function blubberValue() external view returns (uint256 wei_) {
        // option value at CURRENT basefee (before the 1/5 cap reality) -
        // the honest number includes: cap limits realization per tx
        return filled() * RENDER_REFUND_GAS * block.basefee;
    }

    function _supportsExtra(bytes4 id) internal view override returns (bool) {
        return id == type(IWorker).interfaceId;
    }

    function label() external pure returns (string memory) {
        return "adipocyte";
    }
}
