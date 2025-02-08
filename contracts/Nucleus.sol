// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract Nucleus {
    string public identity;
    mapping(string => address) private organelles;
    mapping(string => bool) private replicableOrganelles;
    string[] private organelleNames;

    constructor(
        string memory _identity,
        string[] memory _organelleNames,
        address[] memory _organelleAddresses,
        bool[] memory _replicationFlags
    ) {
        require(
            _organelleNames.length == _organelleAddresses.length,
            "Mismatched input arrays"
        );
        require(
            _organelleNames.length == _replicationFlags.length,
            "Mismatched replication flags"
        );

        identity = _identity;

        for (uint256 i = 0; i < _organelleNames.length; i++) {
            require(_organelleAddresses[i] != address(0), "Invalid address");
            organelles[_organelleNames[i]] = _organelleAddresses[i];
            replicableOrganelles[_organelleNames[i]] = _replicationFlags[i];
            organelleNames.push(_organelleNames[i]);
        }
    }

    function registerOrganelle(
        string memory name,
        address organelleAddress,
        bool replicate
    ) public {
        require(organelleAddress != address(0), "Invalid address");
        if (organelles[name] == address(0)) {
            organelleNames.push(name);
        }
        organelles[name] = organelleAddress;
        replicableOrganelles[name] = replicate; // Updated to avoid shadowing
    }

    function getOrganelle(string memory name) public view returns (address) {
        return organelles[name];
    }

    function getAllOrganelles()
        public
        view
        returns (string[] memory, address[] memory, bool[] memory)
    {
        address[] memory addresses = new address[](organelleNames.length);
        bool[] memory replicationFlags = new bool[](organelleNames.length);

        for (uint256 i = 0; i < organelleNames.length; i++) {
            addresses[i] = organelles[organelleNames[i]];
            replicationFlags[i] = replicableOrganelles[organelleNames[i]];
        }
        return (organelleNames, addresses, replicationFlags);
    }

    function shouldReplicate(string memory name) public view returns (bool) {
        return replicableOrganelles[name];
    }
}
