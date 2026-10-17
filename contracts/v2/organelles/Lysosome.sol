// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Organelle} from "./Organelle.sol";
import {INucleus, IEnergyStore} from "../ICell.sol";

/**
 * @title Lysosome
 * @dev The recycling organelle. Cells accumulate waste: keeper reimbursements
 *      that were never claimed (a keeper vanished, or tipped the cell instead),
 *      organelles that no longer serve (a superseded service module), and dust
 *      that drifts in. The lysosome digests all three and returns the raw
 *      materials to the EnergyStore:
 *
 *        - `digestExpiredCredits`: reclaims keeper credits older than the
 *          colony creditTTL back into the cell's discretionary balance
 *          (an unclaimed pull-payment is not money owed - it is storage rent),
 *        - condemned organelles are deregistered from the Nucleus registry
 *          (instantly revoked capability - autophagy of dead modules),
 *        - any ETH that landed here (vacuolated dust, refunds) is swept home.
 *
 *      This is also the "starvation response": when a cell goes quiet, the
 *      lysosome is what shrinks it gracefully back to essentials.
 */
contract Lysosome is Organelle {
    string[] private condemned; // queued organelle names to deregister

    event CreditDigest(uint256 recovered);
    event OrganelleRecycled(string name);

    constructor(address colony_) Organelle(colony_) {}

    /// @dev Queue an auxiliary organelle for recycling (metabolism / colony
    ///      decision only - a rogue worker cannot digest the nucleus).
    function condemn(string calldata name) external onlyCellCore {
        condemned.push(name);
    }

    /// @dev Work-cycle hook.
    function act(uint256 budgetWei) external {
        _requireActivation();
        IEnergyStore store = _store();

        // 1. digest aged-out keeper credits (reclaimed into available())
        uint256 recovered = store.digestExpiredCredits(16);
        if (recovered > 0) emit CreditDigest(recovered);

        // 2. recycle condemned aux organelles (revokes registry capability)
        INucleus nuc = INucleus(_nucleus);
        for (uint256 i = 0; i < condemned.length; i++) {
            try nuc.unregisterAux(condemned[i]) {
                emit OrganelleRecycled(condemned[i]);
            } catch {
                // already gone / core name: skip, digest nothing
            }
        }
        delete condemned;

        // 3. sweep our own dust home (this contract should hold nothing)
        uint256 dust = address(this).balance;
        if (dust > 0) {
            Address.sendValue(payable(address(store)), dust);
        }
        emit Activated(budgetWei);
    }

    function label() external pure returns (string memory) {
        return "lysosome";
    }
}
