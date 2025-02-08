// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./Nucleus.sol";
import "./Leucoplast.sol";

/**
 * @title Chloroplast
 * @dev Replication organelle. Its primary function is to “copy” the cell by:
 *      - Checking that the Leucoplast holds at least a specified replication cost.
 *      - Retrieving the organelle list from the Nucleus.
 *      - Estimating (simulated here) the gas/funds required based on the number of replicable organelles.
 *      - Withdrawing the required funds from the Leucoplast.
 *      - Deploying new copies of those organelles flagged for replication.
 *      - Deploying a new Nucleus for the new cell copy (with updated organelle lists).
 *      - Deploying a new Leucoplast for the new cell copy.
 *      - Withdrawing half of the remaining funds in the original Leucoplast and transferring them to the new Leucoplast.
 *
 * The contract keeps an internal array of replicated cell (Nucleus) addresses.
 *
 * NOTE: This is a simplified scaffold. In a production system you’d use clone factories and careful gas‑calculation.
 */
contract Chloroplast {
    address public nucleus; // Original Nucleus contract address
    address payable public leucoplast; // Original Leucoplast contract address (payable)
    uint256 public replicationCostEstimate; // Funds (in wei) estimated to cover deployment gas costs

    // Array of replicated cell copies (new Nucleus addresses)
    address[] public replicatedCells;

    event ReplicationStarted(uint256 fundsUsed, uint256 newCellCount);
    event CellReplicated(address newNucleus);

    constructor(
        address _nucleus,
        address payable _leucoplast,
        uint256 _replicationCostEstimate
    ) {
        nucleus = _nucleus;
        leucoplast = _leucoplast;
        replicationCostEstimate = _replicationCostEstimate;
    }

    /// @dev Returns the number of replicated cells.
    function replicatedCellsLength() external view returns (uint256) {
        return replicatedCells.length;
    }

    /**
     * @dev Initiates cell replication.
     *
     * Requirements:
     * - The original Leucoplast must hold at least replicationCostEstimate funds.
     * - Retrieves the full organelle list from the Nucleus.
     * - For each replicable organelle, a new copy is “deployed” (here simulated by generating a pseudo‑address).
     * - Deploys a new Nucleus for the cell copy (using the original’s identity with " copy" appended, the original
     *   Nucleus as parent, and updated organelle arrays).
     * - Deploys a new Leucoplast for the new cell copy using the new Nucleus address.
     * - Withdraws half of the remaining funds from the original Leucoplast and transfers them to the new Leucoplast.
     */
    function replicate() external {
        // Check available funds from the original Leucoplast.
        uint256 cellBalance = Leucoplast(payable(leucoplast)).getBalance();
        require(
            cellBalance >= replicationCostEstimate,
            "Insufficient funds for replication"
        );

        // Retrieve organelle list from Nucleus.
        (
            string[] memory names,
            address[] memory addresses,
            bool[] memory replicable
        ) = Nucleus(nucleus).getAllOrganelles();
        uint256 totalOrg = names.length;

        // Count non-default organelles.
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
        // (For simplicity, we assume replicationCostEstimate is sufficient if cellBalance >= replicationCostEstimate.)

        // Withdraw funds required for replication from the original Leucoplast.
        uint256 fundsForReplication = replicationCostEstimate;
        Leucoplast(payable(leucoplast)).withdraw(
            payable(address(this)),
            fundsForReplication
        );

        // Allocate new arrays for the new cell copy.
        string[] memory newNames = new string[](count);
        address[] memory newAddresses = new address[](count);
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
            if (replicable[i]) {
                // "Deploy" a new copy for replicable organelles (simulate by generating a pseudo‑address).
                newAddresses[j] = address(
                    uint160(
                        uint256(keccak256(abi.encodePacked(block.timestamp, i)))
                    )
                );
                newRepFlags[j] = true;
            } else {
                newAddresses[j] = addresses[i];
                newRepFlags[j] = false;
            }
            j++;
        }

        // Deploy a new Nucleus for the cell copy.
        // Our Nucleus constructor expects five arguments: identity, parent, organelleNames, organelleAddresses, and replication flags.
        Nucleus newNucleus = new Nucleus(
            string(abi.encodePacked(Nucleus(nucleus).identity(), " copy")),
            nucleus, // Register the original Nucleus as the parent.
            newNames,
            newAddresses,
            newRepFlags
        );
        address newNucleusAddr = address(newNucleus);

        // Deploy a new Leucoplast for the new cell copy, passing the new Nucleus address.
        Leucoplast newLeucoplast = new Leucoplast(newNucleusAddr);
        address payable newLeucoplastAddr = payable(address(newLeucoplast));

        // Transfer half of the remaining funds from the original Leucoplast to the new one.
        uint256 remainingBalance = Leucoplast(payable(leucoplast)).getBalance();
        uint256 halfBalance = remainingBalance / 2;
        // Withdraw halfBalance from the original Leucoplast.
        Leucoplast(payable(leucoplast)).withdraw(
            payable(address(this)),
            halfBalance
        );
        // Transfer the withdrawn funds to the new Leucoplast.
        payable(newLeucoplastAddr).transfer(halfBalance);

        // Record the new cell copy.
        replicatedCells.push(newNucleusAddr);

        emit ReplicationStarted(fundsForReplication, replicatedCells.length);
        emit CellReplicated(newNucleusAddr);
    }

    // Allow the contract to receive Ether.
    receive() external payable {}
}
