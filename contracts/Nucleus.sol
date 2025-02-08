// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract Nucleus {
    string public identity; // More likely an instance number
    mapping(string => address) private organelleName2Address; // forward lookup.
    mapping(address => string) private organelleAddress2Name; // reverse lookup.
    mapping(string => bool) private replicableOrganelles;
    string[] private organelleNames; // Name list

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

        // Register parent as an organelle
        organelleName2Address["Parent"] = msg.sender;
        organelleAddress2Name[msg.sender] = "Parent";
        replicableOrganelles["Parent"] = false;
        organelleNames.push("Parent");

        // Self-register as a member organelle
        organelleName2Address["Nucleus"] = address(this);
        organelleAddress2Name[address(this)] = "Nucleus";
        replicableOrganelles["Nucleus"] = true;
        organelleNames.push("Nucleus");

        // Register remaining given organelles
        for (uint256 i = 0; i < _organelleNames.length; i++) {
            require(_organelleAddresses[i] != address(0), "Invalid address");
            organelleName2Address[_organelleNames[i]] = _organelleAddresses[i];
            organelleAddress2Name[_organelleAddresses[i]] = _organelleNames[i];
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
        require(
            msg.sender == organelleName2Address["Parent"],
            "Must be Parent to register new organelle."
        );
        if (organelleName2Address[name] == address(0)) {
            organelleNames.push(name);
        }
        organelleName2Address[name] = organelleAddress;
        organelleAddress2Name[organelleAddress] = name;
        replicableOrganelles[name] = replicate;
    }

    // forward lookup
    function getOrganelleAddress(
        string memory name
    ) public view returns (address) {
        return organelleName2Address[name];
    }

    // reverse lookup
    function getOrganelleName(
        address organelleAddress
    ) public view returns (string memory) {
        return organelleAddress2Name[organelleAddress];
    }

    // Replication flag for an organelle by name
    function shouldReplicateName(
        string memory name
    ) public view returns (bool) {
        return replicableOrganelles[name];
    }

    function getAllOrganelles()
        public
        view
        returns (string[] memory, address[] memory, bool[] memory)
    {
        address[] memory addresses = new address[](organelleNames.length);
        bool[] memory replicationFlags = new bool[](organelleNames.length);

        for (uint256 i = 0; i < organelleNames.length; i++) {
            addresses[i] = organelleName2Address[organelleNames[i]];
            replicationFlags[i] = replicableOrganelles[organelleNames[i]];
        }
        return (organelleNames, addresses, replicationFlags);
    }
}
