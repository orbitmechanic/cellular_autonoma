// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Organelle} from "./Organelle.sol";
import {IEnergyStore, IWorker} from "../ICell.sol";

/**
 * @title GolgiApparatus
 * @dev Packaging, tagging and shipping. Other organelles (or the cell's
 *      service contracts) schedule payments here with a destination, an
 *      amount, a delivery time and a memo; the Golgi holds no money itself
 *      and moves none until activation - at each cycle it draws exactly the
 *      sum of the due shipments from the cell (against the cycle ceiling)
 *      and dispatches the batch.
 *
 *      This gives the organism: scheduled payroll to keepers/agents, batched
 *      fee distribution, time-locked grants to other protocols - the
 *      "exocytosis" of the cell - while the EnergyStore keeps a single
 *      authority surface (workers never hold treasury keys outside their cap).
 *
 *      Atomicity: a batch ships whole or not at all; if due obligations
 *      exceed this cycle's authorization they wait for a hungrier cycle
 *      (real Golgi vesicles don't bud partially).
 */
contract GolgiApparatus is Organelle {
    struct Package {
        address payable recipient;
        uint96 amount;
        uint64 dueAt;
        string memo;
    }
    Package[] public packages;
    uint256 public pendingTotal; // sum of amounts not yet dispatched/cancelled

    /// @dev Bounded logistics (audit: unbounded array + O(n) scan growth).
    ///      Dispatched/cancelled packages are PRUNED via swap-and-pop, so
    ///      `packages` holds at most MAX_LIVE_PACKAGES live entries; indices
    ///      are positions, not stable ids (the swap moves the tail forward).
    uint256 public constant MAX_LIVE_PACKAGES = 64;

    event Scheduled(uint256 indexed id, address indexed recipient, uint256 amount, uint256 dueAt, string memo);
    event Dispatched(uint256 indexed id, address indexed recipient, uint256 amount);
    event Cancelled(uint256 indexed id);
    event Shipped(uint256 count, uint256 totalWei, uint256 skippedDueToCeiling);

    constructor(address colony_) Organelle(colony_) {}

    /// @dev Any registered worker (or the metabolism / colony) may schedule a
    ///      shipment - e.g. a Membrane paying a revenue share to an agent.
    function schedule(address payable recipient, uint96 amount, uint64 dueAt, string calldata memo) external {
        if (msg.sender != COLONY && !_isMetabolism(msg.sender) && !_isWorkerHere(msg.sender)) {
            revert NotRegisteredHere();
        }
        require(packages.length < MAX_LIVE_PACKAGES, "Golgi: logistics queue full");
        packages.push(Package(recipient, amount, dueAt, memo));
        pendingTotal += amount;
        emit Scheduled(packages.length - 1, recipient, amount, dueAt, memo);
    }

    function cancel(uint256 id) external {
        // cancel: scheduler (if still authorized), the cell core, or the colony
        if (msg.sender != COLONY && !_isMetabolism(msg.sender) && !_isWorkerHere(msg.sender)) {
            revert NotRegisteredHere();
        }
        require(id < packages.length, "Golgi: no such package");
        Package memory p = packages[id];
        pendingTotal -= p.amount;
        _prune(id);
        emit Cancelled(id);
    }

    /// @dev Swap-and-pop: move the tail into the vacated slot, drop the tail.
    function _prune(uint256 id) private {
        uint256 last = packages.length - 1;
        if (id != last) {
            packages[id] = packages[last];
        }
        packages.pop();
    }

    function count() external view returns (uint256) {
        return packages.length;
    }

    function dueTotal() public view returns (uint256 total) {
        uint256 n = packages.length;
        for (uint256 i = 0; i < n; i++) {
            if (block.timestamp >= packages[i].dueAt) total += packages[i].amount;
        }
    }

    function act(uint256 budgetWei) external {
        _requireActivation();
        IEnergyStore store = _store();
        uint256 due = dueTotal();
        if (due == 0) {
            emit Activated(budgetWei);
            return;
        }
        // batch atomicity: ship only if this cycle's budget can carry everything due
        if (due <= budgetWei) {
            store.spend(payable(address(this)), due);
            uint256 dispatched = 0;
            // iterate backwards so a swap-pop never skips an entry
            for (uint256 i = packages.length; i > 0; i--) {
                Package memory p = packages[i - 1];
                if (block.timestamp >= p.dueAt) {
                    pendingTotal -= p.amount;
                    _prune(i - 1);
                    Address.sendValue(p.recipient, p.amount);
                    emit Dispatched(i - 1, p.recipient, p.amount);
                    dispatched++;
                }
            }
            emit Shipped(dispatched, due, 0);
        } else {
            emit Shipped(0, 0, due);
        }
        emit Activated(budgetWei);
    }

    function _supportsExtra(bytes4 id) internal view override returns (bool) {
        return id == type(IWorker).interfaceId;
    }

    function label() external pure returns (string memory) {
        return "golgi";
    }
}
