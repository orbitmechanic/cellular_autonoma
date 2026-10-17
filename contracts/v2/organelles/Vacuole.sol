// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Organelle} from "./Organelle.sol";
import {INucleus, IEnergyStore} from "../ICell.sol";

/**
 * @title Vacuole
 * @dev The plant-cell central vacuole, contract version. Three jobs:
 *
 *      1. STORAGE - capital locked with a time schedule (endowment for the
 *         colony's future: a cell that spends everything has no future).
 *         Matured tranches are released back to the EnergyStore each cycle.
 *      2. TOXIN ISOLATION - the peroxisome deposits quarantined capital
 *         here; it never flows back on a timer, only by explicit colony
 *         decision (a jury, not a reflex).
 *      3. TURGOR - the vacuole's total holdings define the cell's internal
 *         pressure: `pressure()` exposes it so the Colony can refuse to
 *         harvest a cell below its structural floor (over-harvesting would
 *         wilt the cell - and harvestColony checks it).
 *
 *      Deposits come from the cell (metabolism authorized withdraw/spend) or
 *      from anyone feeding the vacuole directly; the vacuole only ever pays
 *      out to the cell's own EnergyStore.
 */
contract Vacuole is Organelle {
    struct Tranche {
        uint112 amount;
        uint64 dueAt;
        bool quarantined;
        bool released;
    }
    Tranche[] public tranches;
    uint256 public nextReleaseCursor;

    uint32 public constant MAX_RELEASES_PER_CYCLE = 10;

    event Locked(uint256 indexed id, uint256 amount, uint256 dueAt, bool quarantine);
    event Released(uint256 indexed id, uint256 amount);
    event QuarantineLifted(uint256 indexed id, uint256 amount);

    constructor(address colony_) Organelle(colony_) {}

    /// @dev Time-lock capital for the cell's future. A worker may fund this
    ///      from its own cycle proceeds, or anyone may donate.
    function lock(uint256 duration) external payable {
        require(msg.value > 0 && duration > 0, "Vacuole: nothing to lock");
        tranches.push(Tranche(uint112(msg.value), uint64(block.timestamp + duration), false, false));
        emit Locked(tranches.length - 1, msg.value, block.timestamp + duration, false);
    }

    /// @dev Peroxisome-only: sequester toxin here (isolated, not time-released).
    function lockQuarantine(uint256 duration) external payable {
        require(msg.sender == COLONY || _isPeroxisomeHere(), "Vacuole: quarantine deposit refused");
        require(msg.value > 0, "Vacuole: nothing to sequester");
        tranches.push(Tranche(uint112(msg.value), uint64(block.timestamp + duration), true, false));
        emit Locked(tranches.length - 1, msg.value, block.timestamp + duration, true);
    }

    function _isPeroxisomeHere() private view returns (bool) {
        return INucleus(_nucleus).getRole(msg.sender) == INucleus.Role.WORKER;
    }

    /// @dev Structural pressure: everything this vacuole still holds.
    function pressure() external view returns (uint256 total) {
        uint256 n = tranches.length;
        for (uint256 i = 0; i < n; i++) {
            if (!tranches[i].released) total += tranches[i].amount;
        }
    }

    /// @dev Work cycle: mature ordinary tranches flow back home. Quarantined
    ///      tranches mature only by explicit colony decision.
    function act(uint256 budgetWei) external {
        _requireActivation();
        IEnergyStore store = _store();
        uint256 n = tranches.length;
        uint256 done = 0;
        for (uint256 i = nextReleaseCursor; i < n && done < MAX_RELEASES_PER_CYCLE; i++) {
            Tranche storage t = tranches[i];
            if (!t.released && !t.quarantined && block.timestamp >= t.dueAt) {
                t.released = true;
                Address.sendValue(payable(address(store)), t.amount);
                emit Released(i, t.amount);
                done++;
            }
        }
        // advance cursor past all released entries behind the head
        while (nextReleaseCursor < n && tranches[nextReleaseCursor].released) {
            nextReleaseCursor++;
        }
        emit Activated(budgetWei);
    }

    /// @dev Colony-owner jury: lift a quarantine tranche (returns it to the
    ///      cell) - or in a real deployment, to an arbiter DAO later.
    function releaseQuarantine(uint256 id) external {
        require(msg.sender == COLONY, "Vacuole: colony only");
        Tranche storage t = tranches[id];
        require(t.quarantined && !t.released, "Vacuole: not a live quarantine tranche");
        t.released = true;
        Address.sendValue(payable(address(_store())), t.amount);
        emit QuarantineLifted(id, t.amount);
    }

    function trancheCount() external view returns (uint256) {
        return tranches.length;
    }

    function label() external pure returns (string memory) {
        return "vacuole";
    }

    receive() external payable override {
        // plain donations land unlocked-but-immediate: lock with a 1s due
        // so they join the release cursor naturally next cycle.
        if (msg.value > 0) {
            tranches.push(Tranche(uint112(msg.value), uint64(block.timestamp), false, false));
            emit Locked(tranches.length - 1, msg.value, block.timestamp, false);
        }
    }
}
