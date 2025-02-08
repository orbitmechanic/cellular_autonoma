// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./Nucleus.sol";
import "./Leucoplast.sol";

/**
 * @title Chloroplast
 * @dev Replication organelle. Its primary function is to “copy” the cell by:
 *      - Checking that there are sufficient funds in the Leucoplast for all deployment costs.
 *      - Retrieving the list of organelles from the Nucleus.
 *      - Estimating the gas (or funds) required based on the number of replicable organelles.
 *      - Withdrawing the required funds from the Leucoplast.
 *      - Deploying new copies of those organelles flagged for replication.
 *      - Deploying a new Nucleus for the new cell copy (with the same organelle membership, except that
 *        replicable organelles are replaced by their new copies).
 *      - Withdrawing half the remaining funds from the original Leucoplast and depositing them into the new cell’s Leucoplast.
 *
 *      The contract keeps an internal array of replicated cell (Nucleus) addresses.
 *
 * NOTE: This is a simplified scaffold. In production you’d use cloning patterns and careful gas‐calculation.
 */
contract Chloroplast {
    address public nucleus; // Address of the original Nucleus contract
    address public leucoplast; // Address of the original Leucoplast contract
    uint256 public replicationCostEstimate; // Funds (in wei) estimated to cover deployment gas costs

    // Array of replicated cell copies (new Nucleus addresses)
    address[] public replicatedCells;

    event ReplicationStarted(uint256 fundsUsed, uint256 newCellCount);
    event CellReplicated(address newNucleus);

    constructor(
        address _nucleus,
        address _leucoplast,
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
     * Requirements:
     * - The Leucoplast must hold at least replicationCostEstimate funds.
     * - The function retrieves the full organelle list from the Nucleus.
     * - For each organelle flagged for replication, it "deploys" a copy (here simulated by generating a dummy address).
     * - It deploys a new Leucoplast (via its parameterless constructor) and a new Nucleus with the updated organelle list.
     * - It then withdraws half of the remaining funds in the original Leucoplast and "deposits" them into the new Leucoplast.
     *
     * For simplicity, this function uses simulated deployments.
     */
    function replicate() external {
        // Check available funds from Leucoplast
        uint256 cellBalance = Leucoplast(leucoplast).getBalance();
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
        // Count replicable organelles.
        uint256 replicableCount = 0;
        for (uint256 i = 0; i < totalOrg; i++) {
            if (replicable[i]) {
                replicableCount++;
            }
        }
        // (For a real implementation, use replicableCount and contract sizes to estimate gas cost.)
        require(
            cellBalance >= replicationCostEstimate,
            "Not enough funds to cover replication cost"
        );

        // Withdraw required funds from Leucoplast.
        // (Assumes Chloroplast is registered as a cell member so that withdraw is allowed.)
        uint256 fundsForReplication = replicationCostEstimate;
        Leucoplast(leucoplast).withdraw(
            payable(address(this)),
            fundsForReplication
        );

        // Prepare new organelle arrays for the new cell copy.
        string[] memory newNames = new string[](totalOrg);
        address[] memory newAddresses = new address[](totalOrg);
        bool[] memory newRepFlags = new bool[](totalOrg);

        for (uint256 i = 0; i < totalOrg; i++) {
            newNames[i] = names[i];
            if (replicable[i]) {
                // "Deploy" a new copy for replicable organelles.
                // For simulation, generate a dummy address.
                newAddresses[i] = address(
                    uint160(
                        uint256(keccak256(abi.encodePacked(block.timestamp, i)))
                    )
                );
                newRepFlags[i] = true;
            } else {
                // For non-replicable organelles, use the original address.
                newAddresses[i] = addresses[i];
                newRepFlags[i] = false;
            }
        }

        // Deploy a new Leucoplast contract for the new cell copy.
        Leucoplast newLeucoplast = new Leucoplast();
        address newLeucoplastAddr = address(newLeucoplast);

        // Deploy a new Nucleus for the new cell copy.
        // The new nucleus is created with the updated organelle arrays.
        Nucleus newNucleus = new Nucleus(
            string(abi.encodePacked(Nucleus(nucleus).identity(), " copy")),
            newNames,
            newAddresses,
            newRepFlags
        );
        address newNucleusAddr = address(newNucleus);

        // Transfer half of the remaining funds from the original Leucoplast to the new one.
        uint256 remainingBalance = Leucoplast(leucoplast).getBalance();
        uint256 halfBalance = remainingBalance / 2;
        // Withdraw halfBalance from the original Leucoplast.
        Leucoplast(leucoplast).withdraw(payable(address(this)), halfBalance);
        // Simulate deposit to new Leucoplast by transferring Ether.
        payable(newLeucoplastAddr).transfer(halfBalance);

        // Record the new cell copy.
        replicatedCells.push(newNucleusAddr);

        emit ReplicationStarted(fundsForReplication, replicatedCells.length);
        emit CellReplicated(newNucleusAddr);
    }

    // Allow the contract to receive Ether.
    receive() external payable {}
}
