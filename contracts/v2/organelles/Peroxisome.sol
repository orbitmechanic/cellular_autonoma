// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Organelle} from "./Organelle.sol";
import {INucleus, IEnergyStore} from "../ICell.sol";

interface IVacuole {
    function lockQuarantine(uint256 duration) external payable;
}

interface IGateway {
    function paidBy(address agent) external view returns (uint256);
}

/**
 * @title Peroxisome
 * @dev Detoxification organelle. It breaks down "toxic" capital: money whose
 *      sender community reports mark as harmful (spam from griefing agents,
 *      tainted flows, Sybil farms). Mechanics:
 *
 *        - `report(agent)`: open to anyone (the immune system is crowd-fed);
 *          once an agent accrues `threshold` distinct reporters it is FLAGGED,
 *        - the Membrane consults `screen(agent)` and refuses service to
 *          flagged agents (inflamed tissue stops absorbing),
 *        - each activation cycle the peroxisome routes a flagged agent's
 *          accumulated payments into the Vacuole's QUARANTINE (isolated,
 *          time-locked; released only by the colony owner - a jury step),
 *        - `detox(agent)`: owner/colony can clear a false positive.
 *
 *      Reputation with a skin in the game: reporting is free but only takes
 *      effect at quorum, and the funds go to quarantine, not to a tip jar -
 *      so an accusation can never directly enrich the accuser.
 */
contract Peroxisome is Organelle {
    mapping(address => mapping(address => bool)) public reportedBy;
    mapping(address => uint256) public reportCount;
    mapping(address => bool) public flagged;
    address[] public flaggedList;
    mapping(address => uint256) public quarantined; // per flagged agent, lifetime

    uint16 public threshold = 2; // distinct reporters to flag a toxin
    IGateway public gateway; // revenue meter to size the toxin load
    IVacuole public vacuole; // where sequestered capital is isolated
    uint256 public quarantineDuration = 30 days;
    uint256 public nextFlagScan; // cursor over _creditedList-style bounded loops

    event Reported(address indexed reporter, address indexed agent, uint256 count);
    event Flagged(address indexed agent);
    event Detoxed(address indexed agent);
    event ToxinSequestered(address indexed agent, uint256 amount);
    event ShieldConfigured(address gateway_, address vacuole_, uint16 threshold_);

    constructor(address colony_) Organelle(colony_) {}

    function configure(address gateway_, address vacuole_, uint16 threshold_) external onlyCellCore {
        require(threshold_ > 0, "Peroxisome: threshold zero");
        gateway = IGateway(gateway_);
        vacuole = IVacuole(vacuole_);
        threshold = threshold_;
        emit ShieldConfigured(gateway_, vacuole_, threshold_);
    }

    /// @dev Anyone may report a toxic agent (distinct reporters count).
    function report(address agent) external {
        require(agent != address(0), "Peroxisome: zero agent");
        if (reportedBy[agent][msg.sender]) return; // dedupe silently
        reportedBy[agent][msg.sender] = true;
        reportCount[agent]++;
        emit Reported(msg.sender, agent, reportCount[agent]);
        if (!flagged[agent] && reportCount[agent] >= threshold) {
            flagged[agent] = true;
            flaggedList.push(agent);
            emit Flagged(agent);
        }
    }

    /// @dev View used by the Membrane as an admission filter.
    function screen(address agent) external view returns (bool toxin) {
        return flagged[agent];
    }

    function detox(address agent) external onlyCellCore {
        if (flagged[agent]) {
            flagged[agent] = false;
            emit Detoxed(agent);
        }
    }

    function flaggedCount() external view returns (uint256) {
        return flaggedList.length;
    }

    function act(uint256 budgetWei) external {
        _requireActivation();
        if (address(gateway) == address(0) || address(vacuole) == address(0)) {
            emit Activated(budgetWei);
            return; // no shield wired yet: nothing to detoxify
        }
        IEnergyStore store = _store();
        uint256 ceiling = store.cycleCeiling(address(this));
        uint256 n = flaggedList.length;
        for (uint256 i = 0; i < n; i++) {
            address agent = flaggedList[i];
            if (!flagged[agent]) continue;
            uint256 paid = gateway.paidBy(agent);
            uint256 owed = paid > quarantined[agent] ? paid - quarantined[agent] : 0;
            if (owed == 0) continue;
            uint256 move = owed > budgetWei ? budgetWei : owed;
            if (move > ceiling) break; // cycle budget exhausted; finish next cycle
            // Pull into this organelle (metered by the cycle ceiling), then
            // hand the exact sum to the vacuole's quarantine - so the vacuole
            // always knows the amount came through the detox pathway.
            store.spend(payable(address(this)), move);
            IVacuole(vacuole).lockQuarantine{value: move}(quarantineDuration);
            ceiling -= move;
            quarantined[agent] += move;
            emit ToxinSequestered(agent, move);
        }
        emit Activated(budgetWei);
    }

    function label() external pure returns (string memory) {
        return "peroxisome";
    }
}
