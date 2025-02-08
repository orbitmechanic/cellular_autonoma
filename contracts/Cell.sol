// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract Cell {
    string public identity;

    constructor(string memory _identity) {
        identity = _identity;
    }

    function getIdentity() public view returns (string memory) {
        return identity;
    }
}
