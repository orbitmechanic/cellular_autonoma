// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract Nucleus {
    string public identity;
    mapping(string => address) private organelles;

    constructor(string memory _identity) {
        identity = _identity;
    }

    function registerOrganelle(
        string memory name,
        address organelleAddress
    ) public {
        require(organelleAddress != address(0), "Invalid address");
        organelles[name] = organelleAddress;
    }

    function getOrganelle(string memory name) public view returns (address) {
        return organelles[name];
    }
}
