// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {INucleus, IEnergyStore, IColony} from "./ICell.sol";

/**
 * @title EnergyStore (v2 Leucoplast)
 * @dev A cell's capital ("food"). Holds native coins, tracks who fed the
 *      cell, and pays keepers via pull payments instead of pushing value
 *      during sensitive execution paths.
 *
 * Fixes over v1 Leucoplast:
 *  - Withdrawal authority is role-based (METABOLISM organelle or the Colony).
 *    v1 let ANY registered organelle drain up to half the cell to any
 *    recipient, and its membership check reverted for outsiders instead of
 *    simply failing the modifier.
 *  - Keeper reimbursement is a CREDIT LEDGER (claimable/claim), so the cell
 *    pays for its own metabolism gas without handing ETH to a callback caller
 *    mid-transaction (reentrancy-safe by construction).
 *  - `creditedBy`/`totalFood` accounting: every incoming payment is attributed
 *    to its sender. This is the primitive every "earning" module (tips from
 *    AI agents, storage rental, service fees) will settle against.
 *  - remitUp(): capital flows toward the colony root at mitosis (birth tithe)
 *    and during harvest; v1 had no path for funds to ever reach the root
 *    deployer.
 */
contract EnergyStore is Initializable, ReentrancyGuard {
    address private _nucleus;

    mapping(address => uint256) private _creditedBy; // who fed this cell
    uint256 private _totalFood;
    mapping(address => uint256) public claimable; // keeper -> wei owed
    uint256 public outstandingCredits; // total wei promised to keepers

    // --- worker capability system: metered, expiring spend authorizations ---
    // Ceiling granted to a WORKER organelle for cycle N. Indexed by
    // cycleNonce so unspent authorization EXPIRES with the cycle: the
    // next startCycle() moves to a fresh slot and the old budget is gone.
    mapping(address => mapping(uint256 => uint256)) private _ceiling;
    // Lifetime totals for observability.
    mapping(address => uint256) public authorizedLifetime;
    mapping(address => uint256) public spentLifetime;
    // Keeper credit aging: first-seen timestamp for expiry/reclamation.
    mapping(address => uint256) public creditAge; // keeper -> earliest unclaimed credit ts
    address[] private _creditedList; // enumerable keepers (bounded use)
    uint256 public digestCursor; // rotating scan cursor for digestExpiredCredits

    uint256 public cycleNonce; // incremented by the metabolism each express()
    bool public cycleOpen; // spend() is only live inside an expression window

    function cycleCeiling(address worker) external view returns (uint256) {
        return _ceiling[worker][cycleNonce];
    }

    /// @dev Spendable balance excluding what the cell has already promised
    ///      to keepers. Harvest and mitosis draw from this, never more, so a
    ///      colony sweep can never strand an unclaimed keeper reimbursement.
    function available() external view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > outstandingCredits ? bal - outstandingCredits : 0;
    }

    address public immutable COLONY;

    event Fed(address indexed from, uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount, address indexed by);
    event KeeperCredited(address indexed keeper, uint256 amount);
    event Claimed(address indexed keeper, uint256 amount);
    event RemittedUp(uint256 amount, address destination);
    event WorkerAuthorized(address indexed worker, uint256 ceiling, uint256 cycle);
    event WorkerSpent(address indexed worker, address indexed recipient, uint256 amount);
    event CreditsDigested(address indexed keeper, uint256 recovered);

    error NotCellMember();
    error ZeroRecipient();
    error NotMetabolismOrColony();

    constructor(address colony_) {
        COLONY = colony_;
        _disableInitializers();
    }

    function initialize(address nucleus_) external initializer {
        require(msg.sender == COLONY, "EnergyStore: only colony may initialize");
        _nucleus = nucleus_;
    }

    modifier onlyMetabolismOrColony() {
        if (msg.sender != COLONY && INucleus(_nucleus).getRole(msg.sender) != INucleus.Role.METABOLISM) {
            revert NotCellMember();
        }
        _;
    }

    /// @dev Anyone may feed the cell; the sender is recorded as food credit.
    receive() external payable {
        _creditedBy[msg.sender] += msg.value;
        _totalFood += msg.value;
        emit Fed(msg.sender, msg.value);
    }

    function nucleus() external view returns (address) {
        return _nucleus;
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function creditedBy(address who) external view returns (uint256) {
        return _creditedBy[who];
    }

    function totalFood() external view returns (uint256) {
        return _totalFood;
    }

    function withdraw(address payable recipient, uint256 amount) external onlyMetabolismOrColony {
        if (recipient == address(0)) revert ZeroRecipient();
        uint256 spendable = address(this).balance > outstandingCredits
            ? address(this).balance - outstandingCredits
            : 0;
        require(amount <= spendable, "EnergyStore: exceeds discretionary balance");
        Address.sendValue(recipient, amount);
        emit Withdrawn(recipient, amount, msg.sender);
    }

    /// @dev Book a keeper reimbursement without sending value (pull pattern).
    ///      Increases the outstanding reserve so no sweep can strand it.
    ///      Aging (and therefore digestibility) is only tracked for the
    ///      first MAX_AGING_KEEPERS distinct keepers: beyond that, credits
    ///      remain payable FOREVER - failing toward the keeper, never
    ///      toward seizing their funds (audit: unbounded list growth).
    uint256 public constant MAX_AGING_KEEPERS = 512;

    function creditCaller(address who, uint256 amount) external onlyMetabolismOrColony {
        if (claimable[who] == 0) {
            creditAge[who] = block.timestamp;
            if (_creditedList.length < MAX_AGING_KEEPERS) {
                _creditedList.push(who);
            }
        }
        claimable[who] += amount;
        outstandingCredits += amount;
        emit KeeperCredited(who, amount);
    }

    /// @dev Metabolism marks the start of a new expression cycle, resetting
    ///      every worker's spend ceiling (authorizations are per-cycle) and
    ///      opening the window in which `spend` may be called at all.
    function startCycle() external {
        if (msg.sender != COLONY && INucleus(_nucleus).getRole(msg.sender) != INucleus.Role.METABOLISM) {
            revert NotMetabolismOrColony();
        }
        cycleNonce++;
        cycleOpen = true;
    }

    /// @dev Metabolism closes the window when the cycle ends. A WORKER can
    ///      therefore never call `spend` opportunistically between cycles:
    ///      authorization is only spendable *while being activated*.
    function endCycle() external {
        if (msg.sender != COLONY && INucleus(_nucleus).getRole(msg.sender) != INucleus.Role.METABOLISM) {
            revert NotMetabolismOrColony();
        }
        cycleOpen = false;
    }

    /// @dev Metabolism/Colony grants a WORKER the ability to `spend` up to
    ///      `amount` from the cell during the current cycle.
    function authorize(address worker, uint256 amount) external onlyMetabolismOrColony {
        require(worker != address(0), "EnergyStore: zero worker");
        uint256 ceiling = _ceiling[worker][cycleNonce] + amount;
        _ceiling[worker][cycleNonce] = ceiling;
        authorizedLifetime[worker] += amount;
        emit WorkerAuthorized(worker, ceiling, cycleNonce);
    }

    /// @dev A registered WORKER organelle draws against its cycle ceiling.
    ///      Bounded by both the authorization and the discretionary balance,
    ///      so workers can never out-spend what the cell granted them.
    function spend(address payable recipient, uint256 amount) external nonReentrant {
        require(cycleOpen, "EnergyStore: expression window closed");
        if (recipient == address(0)) revert ZeroRecipient();
        if (msg.sender != COLONY && INucleus(_nucleus).getRole(msg.sender) != INucleus.Role.WORKER) {
            revert NotCellMember();
        }
        require(amount <= _ceiling[msg.sender][cycleNonce], "EnergyStore: over cycle ceiling");
        uint256 spendable = address(this).balance > outstandingCredits
            ? address(this).balance - outstandingCredits
            : 0;
        require(amount <= spendable, "EnergyStore: insufficient discretionary balance");
        _ceiling[msg.sender][cycleNonce] -= amount;
        spentLifetime[msg.sender] += amount;
        Address.sendValue(recipient, amount);
        emit WorkerSpent(msg.sender, recipient, amount);
    }

    /// @dev Lysosome-style reclamation: keeper credits older than the colony
    ///      creditTTL are absorbed back into the cell's discretionary balance.
    ///      (A keeper who never claimed was never actually owed the payout.)
    ///      A rotating cursor keeps old scanned slots from starving new ones.
    function digestExpiredCredits(uint256 maxOps) external returns (uint256 recovered) {
        if (msg.sender != COLONY && INucleus(_nucleus).getRole(msg.sender) != INucleus.Role.WORKER) {
            revert NotCellMember();
        }
        uint256 n = _creditedList.length;
        if (n == 0) return 0;
        uint256 ttl = IColony(COLONY).creditTTL();
        for (uint256 i = 0; i < maxOps && i < n; i++) {
            address keeper = _creditedList[(digestCursor + i) % n];
            uint256 amt = claimable[keeper];
            if (amt > 0 && block.timestamp >= creditAge[keeper] + ttl) {
                claimable[keeper] = 0;
                outstandingCredits -= amt;
                recovered += amt;
                emit CreditsDigested(keeper, amt);
            }
        }
        digestCursor = (digestCursor + maxOps) % n;
    }

    function creditedListLength() external view returns (uint256) {
        return _creditedList.length;
    }

    function creditedListAt(uint256 i) external view returns (address) {
        return _creditedList[i];
    }

    function claim(address payable who, uint256 amount) external nonReentrant {
        // Self-claim only: a keeper's credit cannot be harvested by others.
        require(who == msg.sender, "EnergyStore: claim is self-service only");
        require(amount <= claimable[who], "EnergyStore: not enough credit");
        claimable[who] -= amount;
        outstandingCredits -= amount;
        Address.sendValue(who, amount);
        emit Claimed(who, amount);
    }

    /// @dev Colony-only: push capital upward. If the cell has a parent, send
    ///      to the parent's ENERGY organelle; otherwise (root cell) send to
    ///      the colony recipient address passed in.
    function remitUp(address destination, uint256 amount) external onlyMetabolismOrColony {
        if (msg.sender != COLONY) revert NotCellMember();
        require(amount <= address(this).balance, "EnergyStore: insufficient balance");
        Address.sendValue(payable(destination), amount);
        emit RemittedUp(amount, destination);
    }
}
