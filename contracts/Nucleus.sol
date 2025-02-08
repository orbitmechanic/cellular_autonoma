// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract Nucleus {
    string public identity;
    mapping(string => address) private organelles;
    string[] private organelleNames; // Track names for iteration

    constructor(
        string memory _identity,
        string[] memory _organelleNames,
        address[] memory _organelleAddresses
    ) {
        require(
            _organelleNames.length == _organelleAddresses.length,
            "Mismatched input arrays"
        );

        identity = _identity;

        for (uint256 i = 0; i < _organelleNames.length; i++) {
            require(_organelleAddresses[i] != address(0), "Invalid address");
            organelles[_organelleNames[i]] = _organelleAddresses[i];
            organelleNames.push(_organelleNames[i]); // Store the name for later retrieval
        }
    }

    function registerOrganelle(
        string memory name,
        address organelleAddress
    ) public {
        require(organelleAddress != address(0), "Invalid address");
        if (organelles[name] == address(0)) {
            organelleNames.push(name); // Only add if new
        }
        organelles[name] = organelleAddress;
    }

    function getOrganelle(string memory name) public view returns (address) {
        return organelles[name];
    }

    function getAllOrganelles()
        public
        view
        returns (string[] memory, address[] memory)
    {
        address[] memory addresses = new address[](organelleNames.length);
        for (uint256 i = 0; i < organelleNames.length; i++) {
            addresses[i] = organelles[organelleNames[i]];
        }
        return (organelleNames, addresses);
    }
}
