// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IWorker} from "../v2/ICell.sol";

/**
 * @title MockProtein
 * @dev The "protein" the ribosome translates in tests: a trivial IWorker
 *      module that just counts its activations. Proves the full loop:
 *      program a gene -> order -> translate (clone) -> graft -> express()
 *      activates the new module inside the living cell.
 */
contract MockProtein is IWorker {
    uint256 public activations;
    uint256 public lastBudget;

    function act(uint256 budgetWei) external override {
        activations++;
        lastBudget = budgetWei;
    }

    function label() external pure override returns (string memory) {
        return "mock-protein";
    }
}
