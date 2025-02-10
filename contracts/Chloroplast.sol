// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./Nucleus.sol";
import "./Leucoplast.sol";

/**
 * @title Chloroplast
 * @dev Replication organelle. This contract is cloneable (via the initializer pattern)
 * and its replicate() function clones replicable organelles (using Clones.clone)
 * to create a new cell copy with a new Nucleus and Leucoplast.
 */
contract Chloroplast is Initializable {
    using Clones for address;

    // Original cell’s contracts.
    address public nucleus; // Address of the original Nucleus contract.
    address payable public leucoplast; // Address of the original Leucoplast contract.
    uint256 public replicationCostEstimate; // Funds (in wei) estimated to cover deployment gas costs.

    // Array of replicated cell copies (new Nucleus addresses).
    address[] public replicatedCells;

    event ReplicationStarted(uint256 fundsUsed, uint256 newCellCount);
    event CellReplicated(address newNucleus);
    event CloneCreated(address cloneAddress); // For testing cloneChloroplast()

    // Instead of a constructor, we use initialize() for clone‑ability.
    function initialize(
        address _nucleus,
        address payable _leucoplast,
        uint256 _replicationCostEstimate
    ) public initializer {
        nucleus = _nucleus;
        leucoplast = _leucoplast;
        replicationCostEstimate = _replicationCostEstimate;
    }

    /// @dev Returns the number of replicated cell copies.
    function replicatedCellsLength() external view returns (uint256) {
        return replicatedCells.length;
    }

    /**
     * @dev Helper function that builds new organelle arrays for the new cell copy.
     * It skips default organelles ("Parent" and "Nucleus") and for replicable organelles clones them.
     */
    function _buildNewOrganelleArrays(
        string[] memory names,
        address[] memory orgAddrs,
        bool[] memory reps
    )
        private
        returns (
            string[] memory newNames,
            address[] memory newAddrs,
            bool[] memory newRepFlags
        )
    {
        uint256 totalOrg = names.length;
        uint256 count = 0;
        // Count non-default organelles.
        for (uint256 i = 0; i < totalOrg; i++) {
            if (
                keccak256(bytes(names[i])) == keccak256(bytes("Parent")) ||
                keccak256(bytes(names[i])) == keccak256(bytes("Nucleus"))
            ) {
                continue;
            }
            count++;
        }
        newNames = new string[](count);
        newAddrs = new address[](count);
        newRepFlags = new bool[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < totalOrg; i++) {
            if (
                keccak256(bytes(names[i])) == keccak256(bytes("Parent")) ||
                keccak256(bytes(names[i])) == keccak256(bytes("Nucleus"))
            ) {
                continue;
            }
            newNames[j] = names[i];
            if (reps[i]) {
                // For replicable organelles, clone the template.
                newAddrs[j] = orgAddrs[i].clone();
                newRepFlags[j] = true;
            } else {
                // For non-replicable ones, copy the address.
                newAddrs[j] = orgAddrs[i];
                newRepFlags[j] = false;
            }
            j++;
        }
    }

    /**
     * @dev Initiates cell replication.
     * It withdraws replication funds from the original Leucoplast, builds new organelle arrays via cloning,
     * deploys a new Nucleus (initialized with the new arrays), clones a new Leucoplast (and initializes it),
     * transfers half of the remaining funds to the new Leucoplast, and records the new cell copy.
     */
    function replicate() external {
        // (1) Check available funds.
        uint256 cellBalance = Leucoplast(leucoplast).getBalance();
        require(
            cellBalance >= replicationCostEstimate,
            "Insufficient funds for replication"
        );

        // (2) Withdraw replication funds from the original Leucoplast.
        uint256 fundsForReplication = replicationCostEstimate;
        Leucoplast(leucoplast).withdraw(
            payable(address(this)),
            fundsForReplication
        );

        // (3) Retrieve organelle list from the original Nucleus.
        (
            string[] memory names,
            address[] memory orgAddrs,
            bool[] memory reps
        ) = Nucleus(nucleus).getAllOrganelles();

        // (4) Build new organelle arrays (skipping "Parent" and "Nucleus").
        (
            string[] memory newNames,
            address[] memory newAddrs,
            bool[] memory newRepFlags
        ) = _buildNewOrganelleArrays(names, orgAddrs, reps);

        // (5) Deploy a new Nucleus for the cell copy.
        Nucleus newNucleus = new Nucleus();
        newNucleus.initialize(
            string(abi.encodePacked(Nucleus(nucleus).identity(), " copy")),
            nucleus, // Original Nucleus as parent.
            newNames,
            newAddrs,
            newRepFlags
        );
        address newNucleusAddr = address(newNucleus);

        // (6) Deploy a new Leucoplast clone.
        address newLeucoplastAddr = payable(address(leucoplast).clone());
        Leucoplast newLeucoplast = Leucoplast(payable(newLeucoplastAddr));
        newLeucoplast.initialize(newNucleusAddr);

        // (7) Transfer half of the remaining funds from the original Leucoplast to the new Leucoplast.
        uint256 remainingBalance = Leucoplast(payable(leucoplast)).getBalance();
        uint256 halfBalance = remainingBalance / 2;
        Leucoplast(payable(leucoplast)).withdraw(
            payable(address(this)),
            halfBalance
        );
        payable(newLeucoplastAddr).transfer(halfBalance);

        // (8) Record the new cell copy.
        replicatedCells.push(newNucleusAddr);

        emit ReplicationStarted(fundsForReplication, replicatedCells.length);
        emit CellReplicated(newNucleusAddr);
    }

    /**
     * @dev Makes Chloroplast cloneable. Uses OpenZeppelin’s Clones library to deploy
     * a minimal-proxy copy of this contract and then calls initialize() on it.
     */
    function cloneChloroplast() external returns (address) {
        address cloneAddr = payable(address(this).clone());
        Chloroplast(payable(cloneAddr)).initialize(
            nucleus,
            leucoplast,
            replicationCostEstimate
        );
        emit CloneCreated(cloneAddr);
        return cloneAddr;
    }

    // Allow the contract to receive Ether.
    receive() external payable {}
}
