// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {INucleus, IEnergyStore, IColony} from "./ICell.sol";

/**
 * @title Chloroplast (v2)
 * @dev The cell's metabolism and reproductive organ — and its economic
 *      interface with the outside world.
 *
 * The v1 Chloroplast could replicate, but only if a human sent the
 * transaction and paid the gas out of pocket. The funds it "reserved" for
 * replication were withdrawn into itself and sat there unused, because an
 * EVM contract cannot pay for the transaction that calls it. That is THE
 * blocker for "self-replication without human intervention", and it is not
 * solvable by contract logic alone — but it IS solvable by *economics*:
 *
 *   Anyone (a keeper bot, a Chainlink Automation node, a friendly agent, or
 *   a passerby) can trigger replicate(). The cell then computes the gas the
 *   trigger actually cost and CREDITS it back from its own food. Triggering
 *   the cell becomes a paid job. No human goodwill required, ever.
 *
 * The cell remains EVM-incapable of initiating transactions (a hard chain
 * rule), but it becomes economically autonomous: it always pays its own
 * bills from its own earnings.
 *
 * Other v2 fixes vs v1:
 *  - replicate() clones from TEMPLATES via the Colony (v1 cloned live
 *    instances, so proxy depth grew with every generation and gas costs
 *    compounded along the lineage).
 *  - Cooldown + generation cap + reserve floor protect the colony from
 *    runaway division (v1 could divide forever with no limits).
 *  - cloneChloroplast() is gone: it produced clones still pointing at the
 *    MOTHER's nucleus and leucoplast.
 */
contract Chloroplast is Initializable {
    address private _nucleus;
    uint256 private _lastBirth;
    uint256 public births;

    address public immutable COLONY;

    event Replicated(address indexed parentNucleus, address indexed childNucleus, uint256 indexed childSerial, uint256 endowment, uint256 keeperCredit, address keeper);

    constructor(address colony_) {
        COLONY = colony_;
        _disableInitializers();
    }

    function initialize(address nucleus_) external initializer {
        require(msg.sender == COLONY, "Chloroplast: only colony may initialize");
        _nucleus = nucleus_;
    }

    function nucleus() external view returns (address) {
        return _nucleus;
    }

    function lastBirth() external view returns (uint256) {
        return _lastBirth;
    }

    function _energy() private view returns (IEnergyStore) {
        return IEnergyStore(INucleus(_nucleus).getOrganelleByRole(INucleus.Role.ENERGY));
    }

    /// @dev Pure view for prospective triggers: can this cell afford to
    ///      divide right now? Mirrors the checks in replicate().
    function canReplicate(uint256 endowment) external view returns (bool ok, uint8 reason) {
        INucleus n = INucleus(_nucleus);
        IColony col = IColony(COLONY);
        if (!n.alive()) return (false, 1); // dead cell
        if (n.generation() >= col.maxGeneration()) return (false, 2); // terminal generation
        if (block.timestamp < _lastBirth + col.minBirthInterval()) return (false, 3); // cooldown
        uint256 avail = _energy().available();
        if (avail < endowment + col.birthFee() + col.minReserve()) return (false, 4); // not enough food
        return (true, 0);
    }

    /**
     * @dev Mitosis with automatic keeper compensation.
     *      Anyone may call; the caller is credited for the gas they spent
     *      (plus the colony stipend), capped so a reverts-catcher can never
     *      strip the cell's larder.
     */
    function replicate(uint256 endowment) external returns (address child) {
        uint256 entryGas = gasleft(); // captured first: covers ALL of replicate's own execution

        INucleus n = INucleus(_nucleus);        IColony col = IColony(COLONY);
        require(n.alive(), "Chloroplast: cell is dead");
        require(n.getRole(address(this)) == INucleus.Role.METABOLISM, "Chloroplast: not this cell's metabolism");
        require(n.generation() < col.maxGeneration(), "Chloroplast: terminal generation");
        require(block.timestamp >= _lastBirth + col.minBirthInterval(), "Chloroplast: growth phase cooldown");

        IEnergyStore energy = _energy();
        uint256 available = energy.available();
        require(available >= endowment + col.birthFee() + col.minReserve(), "Chloroplast: insufficient food for division");

        child = col.birth(address(n), endowment);

        // Reimburse the trigger from the cell's own food.
        //
        // On-chain gasleft() accounting CANNOT reproduce the chain's billed
        // gas: EIP-150 retains 1/64 of gas at every external-call boundary
        // (replicate -> birth -> withdraw -> sendValue -> initialize ...),
        // and that retained gas is billed to the trigger but never observed
        // by the callee frames. So instead of a fragile on-chain estimate we
        // pay the Colony's budgeted figure, which the owner tunes per chain,
        // floored by the (measurable) execution gas. maxRefundCap and
        // maxRefundBps then bound what any single trigger can extract, so a
        // reverts-catcher can never strip the cell's larder.
        uint256 executionGas = entryGas - gasleft();
        uint256 reimbursable = executionGas > col.birthGasBudget() ? executionGas : col.birthGasBudget();
        uint256 refund = reimbursable * tx.gasprice + col.keeperStipend();
        uint256 cap = col.maxRefundCap();
        uint256 shareCap = (energy.available() * col.maxRefundBps()) / 10000;
        if (refund > cap) refund = cap;
        if (refund > shareCap) refund = shareCap;
        if (refund > 0) energy.creditCaller(msg.sender, refund);

        _lastBirth = block.timestamp;
        births++;
        emit Replicated(address(n), child, NucleusLike(child).serial(), endowment, refund, msg.sender);
    }
}

interface NucleusLike {
    function serial() external view returns (uint256);
}
