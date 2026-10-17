// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/**
 * @title MockNoInterface
 * @dev A module that CAN be initialized like an organelle but does NOT
 *      declare IWorker via ERC-165 - used by the audit regression test to
 *      prove the registry gate rejects silent workers.
 */
contract MockNoInterface {
    address public nucleus;

    function initialize(address nucleus_) external {
        nucleus = nucleus_;
    }
}
