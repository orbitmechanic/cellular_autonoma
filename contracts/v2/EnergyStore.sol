// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {INucleus, IEnergyStore} from "./ICell.sol";

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

    error NotCellMember();
    error ZeroRecipient();

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
    function creditCaller(address who, uint256 amount) external onlyMetabolismOrColony {
        claimable[who] += amount;
        outstandingCredits += amount;
        emit KeeperCredited(who, amount);
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
