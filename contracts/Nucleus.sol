// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

// Import OpenZeppelin’s Clones library and the Initializable base contract.
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract Nucleus is Initializable {
    using Clones for address;

    string public identity; // e.g. cell strain-serial#
    mapping(string => address) private organelleName2Address; // Forward lookup.
    mapping(address => string) private organelleAddress2Name; // Reverse lookup.
    mapping(string => bool) private replicableOrganelles; // Replication flags.
    string[] private organelleNames; // Ordered list of organelle names.

    // initialize() replaces the constructor.
    function initialize(
        string memory _identity, // e.g. "Cell1"
        address _parentAddress, // Parent’s address
        string[] memory _organelleNames,
        address[] memory _organelleAddresses,
        bool[] memory _replicationFlags
    ) public initializer {
        require(
            _organelleNames.length == _organelleAddresses.length,
            "Mismatched input arrays"
        );
        require(
            _organelleNames.length == _replicationFlags.length,
            "Mismatched replication flags"
        );

        identity = _identity;

        // Explicitly assign Parent to the given address.
        organelleName2Address["Parent"] = _parentAddress;
        organelleAddress2Name[_parentAddress] = "Parent";
        replicableOrganelles["Parent"] = false;
        organelleNames.push("Parent");

        // Self-register as Nucleus.
        organelleName2Address["Nucleus"] = address(this);
        organelleAddress2Name[address(this)] = "Nucleus";
        replicableOrganelles["Nucleus"] = true;
        organelleNames.push("Nucleus");

        // Register additional organelles.
        for (uint256 i = 0; i < _organelleNames.length; i++) {
            require(_organelleAddresses[i] != address(0), "Invalid address");
            // If already registered and caller is Parent, update the mapping.
            if (organelleName2Address[_organelleNames[i]] != address(0)) {
                organelleName2Address[_organelleNames[i]] = _organelleAddresses[
                    i
                ];
                organelleAddress2Name[_organelleAddresses[i]] = _organelleNames[
                    i
                ];
                replicableOrganelles[_organelleNames[i]] = _replicationFlags[i];
            } else {
                organelleNames.push(_organelleNames[i]);
                organelleName2Address[_organelleNames[i]] = _organelleAddresses[
                    i
                ];
                organelleAddress2Name[_organelleAddresses[i]] = _organelleNames[
                    i
                ];
                replicableOrganelles[_organelleNames[i]] = _replicationFlags[i];
            }
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
        // Allow Parent to update an existing registration.
        if (organelleName2Address[name] != address(0)) {
            organelleName2Address[name] = organelleAddress;
            organelleAddress2Name[organelleAddress] = name;
            replicableOrganelles[name] = replicate;
            return;
        }
        organelleNames.push(name);
        organelleName2Address[name] = organelleAddress;
        organelleAddress2Name[organelleAddress] = name;
        replicableOrganelles[name] = replicate;
    }

    // Forward lookup.
    function getOrganelleAddress(
        string calldata name
    ) external view returns (address) {
        address organelle = organelleName2Address[name];
        require(organelle != address(0), "Organelle not found");
        return organelle;
    }

    // Reverse lookup.
    function getOrganelleName(
        address organelleAddress
    ) external view returns (string memory) {
        require(
            bytes(organelleAddress2Name[organelleAddress]).length != 0,
            "Organelle not found"
        );
        return organelleAddress2Name[organelleAddress];
    }

    // Replication flag lookup.
    function shouldReplicateName(
        string calldata name
    ) external view returns (bool) {
        return replicableOrganelles[name];
    }

    // Get the full organelle arrays.
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

    // A clone factory function that clones this Nucleus and initializes the clone.
    function cloneCell() external returns (address) {
        // Create a minimal-proxy clone of this contract.
        address clone = address(this).clone();
        // Initialize the clone.
        // For the new cell, you might want to start with a clean slate for extra organelles.
        // Here we pass empty arrays for additional organelles.
        Nucleus(clone).initialize(
            string(abi.encodePacked(identity, " copy")),
            address(this),
            new string[](0),
            new address[](0),
            new bool[](0)
        );
        return clone;
    }
}
