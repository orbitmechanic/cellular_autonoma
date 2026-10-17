// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title MockCloner
 * @dev Test-only EVM hammer: lets a test perform the raw clone + optional
 *      initialize that the Colony normally does atomically, so the audit
 *      regression test can ATTEMPT the clone-init front-run that the
 *      colony-only initialize (v2.2) is supposed to defeat.
 */
contract MockCloner {
    function clone(address template) external returns (address instance) {
        instance = Clones.clone(template);
    }

    function cloneAndInit(address template, address nucleus) external returns (address instance) {
        instance = Clones.clone(template);
        Address.functionCall(instance, abi.encodeWithSignature("initialize(address)", nucleus));
    }
}
