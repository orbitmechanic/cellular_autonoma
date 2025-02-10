// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./Nucleus.sol";
import "./Leucoplast.sol";

/**
 * @title Chloroplast
 * @dev Replication organelle. This contract is cloneable (via the initializer pattern)
 * and its replicate() function clones replicable organelles (using Clones.clone) to create
 * a new cell: it deploys a new Nucleus with updated organelle arrays and a new Leucoplast.
 */
contract Chloroplast is Initializable {
    using Clones for address;

    // Original cell’s contracts.
    address public nucleus; // Address of the original Nucleus contract.
    address payable public leucoplast; // Address of the original Leucoplast contract.
    uint256 public replicationCostEstimate; // Cost (in wei) to cover replication funds.

    // Array of replicated cell copies (new Nucleus addresses).
    address[] public replicatedCells;

    event ReplicationStarted(uint256 fundsUsed, uint256 newCellCount);
    event CellReplicated(address newNucleus);

    // Replace constructor with initialize.
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
     * @dev Replicates the cell.
     * Steps:
     *   1. Check that the original Leucoplast holds at least replicationCostEstimate funds.
     *   2. Withdraw that amount from the original Leucoplast.
     *   3. Retrieve the organelle list from the original Nucleus.
     *   4. For each organelle (skipping defaults "Parent" and "Nucleus"):
     *         - If replicable, clone it via Clones.clone(template)
     *         - Otherwise, copy the original address.
     *   5. Deploy a new Nucleus by calling its initialize() function with the new arrays.
     *   6. Deploy a new Leucoplast clone and initialize it with the new Nucleus’s address.
     *   7. Withdraw half of the remaining funds from the original Leucoplast and transfer them to the new Leucoplast.
     *   8. Record the new cell copy.
     */
    function replicate() external {
        // (1) Check funds.
        uint256 cellBalance = Leucoplast(leucoplast).getBalance();
        require(
            cellBalance >= replicationCostEstimate,
            "Insufficient funds for replication"
        );

        // (2) Withdraw funds required for replication.
        uint256 fundsForReplication = replicationCostEstimate;
        Leucoplast(leucoplast).withdraw(
            payable(address(this)),
            fundsForReplication
        );

        // (3) Retrieve organelle list from Nucleus.
        (
            string[] memory names,
            address[] memory orgAddrs,
            bool[] memory reps
        ) = Nucleus(nucleus).getAllOrganelles();
        uint256 totalOrg = names.length;

        // (4) Count non-default organelles (skip "Parent" and "Nucleus").
        uint256 count = 0;
        for (uint256 i = 0; i < totalOrg; i++) {
            if (
                keccak256(bytes(names[i])) == keccak256(bytes("Parent")) ||
                keccak256(bytes(names[i])) == keccak256(bytes("Nucleus"))
            ) {
                continue;
            }
            count++;
        }
        // Allocate arrays of the correct size.
        string[] memory newNames = new string[](count);
        address[] memory newAddrs = new address[](count);
        bool[] memory newRepFlags = new bool[](count);

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
                // (4a) For replicable organelles, clone the template.
                // Assumes the stored address is a template contract.
                address newOrganelle = orgAddrs[i].clone();
                newAddrs[j] = newOrganelle;
                newRepFlags[j] = true;
            } else {
                // (4b) For non-replicable ones, copy the address.
                newAddrs[j] = orgAddrs[i];
                newRepFlags[j] = false;
            }
            j++;
        }

        // (5) Deploy a new Nucleus for the cell copy.
        // Here, we manually deploy a new Nucleus instance and then initialize it.
        Nucleus newNucleus = new Nucleus();
        newNucleus.initialize(
            string(abi.encodePacked(Nucleus(nucleus).identity(), " copy")),
            nucleus, // Original Nucleus is considered the parent.
            newNames,
            newAddrs,
            newRepFlags
        );
        address newNucleusAddr = address(newNucleus);

        // (6) Deploy a new Leucoplast clone.
        // We assume the original Leucoplast is cloneable (it uses the initializer pattern).
        // Using Clones.clone on leucoplast gives us a new instance.
        address newLeucoplastAddr = payable(address(leucoplast).clone());
        // Attach the interface and initialize with the new Nucleus address.
        Leucoplast newLeucoplast = Leucoplast(payable(newLeucoplastAddr));

        newLeucoplast.initialize(newNucleusAddr);

        // (7) Transfer half of the remaining funds from the original Leucoplast to the new one.
        uint256 remainingBalance = Leucoplast(leucoplast).getBalance();
        uint256 halfBalance = remainingBalance / 2;
        Leucoplast(leucoplast).withdraw(payable(address(this)), halfBalance);
        payable(newLeucoplastAddr).transfer(halfBalance);

        // (8) Record the new cell copy.
        replicatedCells.push(newNucleusAddr);

        emit ReplicationStarted(fundsForReplication, replicatedCells.length);
        emit CellReplicated(newNucleusAddr);
    }

    /**
     * @dev Makes Chloroplast cloneable. This function uses OpenZeppelin Clones to deploy
     * a minimal-proxy copy of this contract and then calls initialize() on it.
     */
    function cloneChloroplast() external returns (address) {
        address cloneAddr = address(this).clone();
        Chloroplast(payable(cloneAddr)).initialize(
            nucleus,
            leucoplast,
            replicationCostEstimate
        );
        return cloneAddr;
    }

    // Allow the contract to receive Ether.
    receive() external payable {}
}
