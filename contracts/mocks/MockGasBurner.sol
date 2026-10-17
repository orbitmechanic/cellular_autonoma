// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IWorker} from "../v2/ICell.sol";
import {IERC165} from "../v2/IERCs.sol";

/**
 * @title MockGasBurner
 * @dev A malignant "organ": its act() gobbles gas with an unbounded spin
 *      loop, simulating the worst-case grafted module. The per-organ gas
 *      stipend the metabolism passes (Chloroplast.express act{gas:...})
 *      must contain it: the cycle survives, this organ just fails.
 */
contract MockGasBurner is IWorker {
    uint256 public counter;
    address public nucleus;

    function initialize(address nucleus_) external {
        nucleus = nucleus_;
    }

    function act(uint256) external override {
        while (gasleft() > 1000) {
            unchecked {
                ++counter;
            }
        }
    }

    function label() external pure override returns (string memory) {
        return "mock-gas-burner";
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IWorker).interfaceId;
    }

    receive() external payable {}
}
