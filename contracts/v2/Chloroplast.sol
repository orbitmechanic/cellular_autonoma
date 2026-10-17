// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {INucleus, IEnergyStore, IColony, IWorker} from "./ICell.sol";

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
    uint256 private _lastExpress;
    uint256 public births;
    uint256 public cycles;

    address public immutable COLONY;

    event Replicated(address indexed parentNucleus, address indexed childNucleus, uint256 indexed childSerial, uint256 endowment, uint256 keeperCredit, address keeper);
    event Expressed(address indexed worker, uint256 spent);
    event OrganFailed(address indexed worker);
    event MetabolicCycle(address indexed nucleus, uint256 indexed cycle, uint256 workers, uint256 spent, uint256 keeperCredit, address trigger);

    /// @dev Pure view mirroring express() gates (keepers poll this).
    function canExpress() external view returns (bool ok, uint8 reason) {
        INucleus n = INucleus(_nucleus);
        if (!n.alive()) return (false, 1);
        if (block.timestamp < _lastExpress + IColony(COLONY).cycleMinInterval()) return (false, 2);
        if (n.workersCount() == 0) return (false, 3); // no genes to express
        return (true, 0);
    }

    function lastExpress() external view returns (uint256) {
        return _lastExpress;
    }

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

        INucleus n = INucleus(_nucleus);
        IColony col = IColony(COLONY);
        require(n.alive(), "Chloroplast: cell is dead");
        require(n.getRole(address(this)) == INucleus.Role.METABOLISM, "Chloroplast: not this cell's metabolism");
        require(n.generation() < col.maxGeneration(), "Chloroplast: terminal generation");
        require(block.timestamp >= _lastBirth + col.minBirthInterval(), "Chloroplast: growth phase cooldown");

        IEnergyStore energy = _energy();
        require(
            energy.available() >= endowment + col.birthFee() + col.minReserve(),
            "Chloroplast: insufficient food for division"
        );

        child = col.birth(address(n), endowment);
        uint256 refund = _reimburseKeeper(entryGas);

        _lastBirth = block.timestamp;
        births++;
        emit Replicated(address(n), child, NucleusLike(child).serial(), endowment, refund, msg.sender);
    }

    /**
     * @dev Gene expression: the daily "work cycle" of the cell. Any keeper
     *      may run it (and is reimbursed the same way as for division). The
     *      metabolism:
     *        1. opens a fresh EnergyStore cycle (worker ceilings reset),
     *        2. authorizes each WORKER organelle a bounded budget,
     *        3. calls its act(budget) hook (mito harvests/stakes, Golgi
     *           dispatches due shipments, lysosome digests expired credits,
     *           vacuole releases matured locks, ...),
     *        4. revokes the remainder of each ceiling (revoke happens by the
     *           cycle reset on the next express).
     *
     *      Workers can ONLY move what the metabolism authorized for THIS
     *      cycle, and only within the cell's discretionary balance: optional
     *      organelles are economically neuter until the cell plugs them in.
     */
    function express() external {
        uint256 entryGas = gasleft();

        INucleus n = INucleus(_nucleus);
        IColony col = IColony(COLONY);
        require(n.alive(), "Chloroplast: cell is dead");
        require(n.getRole(address(this)) == INucleus.Role.METABOLISM, "Chloroplast: not this cell's metabolism");
        require(block.timestamp >= _lastExpress + col.cycleMinInterval(), "Chloroplast: cycle cooldown");

        IEnergyStore energy = _energy();
        address[] memory workers = n.workerList();

        energy.startCycle();
        uint256 spent = 0;
        uint256 count = workers.length;
        for (uint256 i = 0; i < count; i++) {
            address w = workers[i];
            // Fresh budget per worker: pool is a share of what's LEFT, so
            // many organs in one cycle can never jointly overrun it - every
            // draw shrinks the next worker's allowance naturally.
            uint256 pool = (energy.available() * col.workerBudgetBps()) / 10000;
            uint256 budget = pool > col.perWorkerCeiling() ? col.perWorkerCeiling() : pool;
            if (budget == 0) break;
            energy.authorize(w, budget);
            // A single faulty organelle must not brick the whole cell:
            // activate with try/catch and keep cycling. A revert here just
            // means that organ skipped this cycle (it keeps its unspent
            // ceiling, which expires on its own at the next startCycle).
            try IWorker(w).act(budget) {
                uint256 used = budget - energy.cycleCeiling(w);
                spent += used;
                emit Expressed(w, used);
            } catch {
                emit OrganFailed(w);
            }
        }

        uint256 refund = _reimburseKeeper(entryGas);
        _lastExpress = block.timestamp;
        cycles++;
        emit MetabolicCycle(address(n), cycles, count, spent, refund, msg.sender);
    }

    /// @dev Shared keeper compensation: pays the trigger from the cell's own
    ///      food using the Colony's gas budget, floored by actual execution
    ///      gas and capped by maxRefundCap / maxRefundBps.
    ///
    ///      On-chain gasleft() accounting CANNOT reproduce the chain's billed
    ///      gas exactly: EIP-150 retains 1/64 of gas at every external-call
    ///      boundary, which the chain bills the trigger for but callee frames
    ///      never observe. That is why the Colony carries a tuned
    ///      birthGasBudget per chain instead of trusting the measurement.
    function _reimburseKeeper(uint256 entryGas) private returns (uint256 refund) {
        IColony col = IColony(COLONY);
        IEnergyStore energy = _energy();
        uint256 executionGas = entryGas - gasleft() + 40000; // + dispatch slack
        uint256 reimbursable = executionGas > col.birthGasBudget() ? executionGas : col.birthGasBudget();
        refund = reimbursable * tx.gasprice + col.keeperStipend();
        uint256 cap = col.maxRefundCap();
        uint256 shareCap = (energy.available() * col.maxRefundBps()) / 10000;
        if (refund > cap) refund = cap;
        if (refund > shareCap) refund = shareCap;
        if (refund > 0) energy.creditCaller(msg.sender, refund);
    }
}

interface NucleusLike {
    function serial() external view returns (uint256);
}
