// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract Nucleus {
    string public identity;
    mapping(string => address) private organelles;

    constructor(
        string memory _identity,
        string[] memory organelleNames,
        address[] memory organelleAddresses
    ) {
        require(
            organelleNames.length == organelleAddresses.length,
            "Mismatched input arrays"
        );

        identity = _identity;

        for (uint256 i = 0; i < organelleNames.length; i++) {
            require(organelleAddresses[i] != address(0), "Invalid address");
            organelles[organelleNames[i]] = organelleAddresses[i];
        }
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
