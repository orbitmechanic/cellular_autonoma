// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IYield} from "../v2/organelles/Mitochondrion.sol";

/**
 * @title MockYieldVault
 * @dev A toy Aave/LST for the test organism. Deposits accrue interest at a
 *      linear `interestPerSecondBps` on principal (a stand-in for real
 *      lending yield), and the vault can go partially "broke" (bad debt) to
 *      exercise the cell's risk. This is deliberately NOT the real world; the
 *      Mitochondrion only ever talks to it through the small IYield surface,
 *      so a genuine money-market adapter can replace it unchanged.
 */
contract MockYieldVault is IYield {
    uint128 public interestPerSecondBps; // bps of principal per second (tiny)
    mapping(address => uint256) public principal;
    mapping(address => uint256) public lastAccrual;
    uint256 public badDebt;

    event Deposited(address indexed who, uint256 amount);
    event Withdrew(address indexed who, uint256 amount);
    event Insolvency(uint256 shortfall);

    function setRate(uint128 bpsPerSecond) external {
        interestPerSecondBps = bpsPerSecond;
    }

    function _accrue(address who) private {
        uint256 p = principal[who];
        if (p == 0) {
            lastAccrual[who] = block.timestamp;
            return;
        }
        uint256 elapsed = block.timestamp - lastAccrual[who];
        uint256 gain = (p * interestPerSecondBps * elapsed) / 10000;
        principal[who] = p + gain;
        lastAccrual[who] = block.timestamp;
    }

    function deposit(address beneficiary) external payable {
        _accrue(beneficiary);
        principal[beneficiary] += msg.value;
        emit Deposited(beneficiary, msg.value);
    }

    function withdraw(address to, uint256 assets) external {
        _accrue(msg.sender);
        uint256 p = principal[msg.sender];
        uint256 amt = assets > p ? p : assets;
        uint256 bal = address(this).balance;
        if (amt > bal) {
            emit Insolvency(amt - bal);
            amt = bal;
        }
        principal[msg.sender] = p - amt; // note: reflects paid-out incl. accrued
        Address.sendValue(payable(to), amt);
        emit Withdrew(msg.sender, amt);
    }

    function assetsOf(address beneficiary) external view returns (uint256) {
        uint256 p = principal[beneficiary];
        if (p == 0) return 0;
        uint256 gain = (p * interestPerSecondBps * (block.timestamp - lastAccrual[beneficiary])) / 10000;
        return p + gain;
    }

    /// @dev Simulate a protocol loss to test the cell's resilience.
    function drain(uint256 amount) external {
        Address.sendValue(payable(msg.sender), amount);
    }

    receive() external payable {}
}
