// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract Nucleus {
    string public identity; // More likely an instance number
    mapping(string => address) private organelleName2Address; // Forward lookup
    mapping(address => string) private organelleAddress2Name; // Reverse lookup
    mapping(string => bool) private replicableOrganelles; // Replication flags
    string[] private organelleNames; // Ordered list of organelle names

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

        // Register Parent (creator) as an organelle
        organelleName2Address["Parent"] = msg.sender;
        organelleAddress2Name[msg.sender] = "Parent";
        replicableOrganelles["Parent"] = false;
        organelleNames.push("Parent");

        // Self-register as Nucleus
        organelleName2Address["Nucleus"] = address(this);
        organelleAddress2Name[address(this)] = "Nucleus";
        replicableOrganelles["Nucleus"] = true;
        organelleNames.push("Nucleus");

        // Register remaining given organelles
        for (uint256 i = 0; i < _organelleNames.length; i++) {
            require(_organelleAddresses[i] != address(0), "Invalid address");
            require(
                organelleName2Address[_organelleNames[i]] == address(0),
                "Organelle name already registered"
            );

            organelleName2Address[_organelleNames[i]] = _organelleAddresses[i];
            organelleAddress2Name[_organelleAddresses[i]] = _organelleNames[i];
            replicableOrganelles[_organelleNames[i]] = _replicationFlags[i];
            organelleNames.push(_organelleNames[i]);
        }
    }

    function registerOrganelle(
        string calldata name,
        address organelleAddress,
        bool replicate
    ) external {
        require(organelleAddress != address(0), "Invalid address");
        require(
            msg.sender == organelleName2Address["Parent"],
            "Only Parent can register"
        );
        require(
            organelleName2Address[name] == address(0),
            "Organelle name already registered"
        );

        organelleNames.push(name);
        organelleName2Address[name] = organelleAddress;
        organelleAddress2Name[organelleAddress] = name;
        replicableOrganelles[name] = replicate;
    }

    // Forward lookup
    function getOrganelleAddress(
        string calldata name
    ) external view returns (address) {
        address organelle = organelleName2Address[name];
        require(organelle != address(0), "Organelle not found");
        return organelle;
    }

    // Reverse lookup
    function getOrganelleName(
        address organelleAddress
    ) external view returns (string memory) {
        require(
            bytes(organelleAddress2Name[organelleAddress]).length != 0,
            "Organelle not found"
        );
        return organelleAddress2Name[organelleAddress];
    }

    // Replication flag lookup
    function shouldReplicateName(
        string calldata name
    ) external view returns (bool) {
        return replicableOrganelles[name];
    }

    function getAllOrganelles()
        external
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
