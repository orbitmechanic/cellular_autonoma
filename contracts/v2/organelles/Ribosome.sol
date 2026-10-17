// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Organelle} from "./Organelle.sol";
import {INucleus, IWorker} from "../ICell.sol";

/**
 * @title Ribosome
 * @dev Translates "mRNA programs" (approved implementation templates) into
 *      fresh organelle instances - proteins - using minimal-proxy clones.
 *      This is the in-cell evolution engine: new capabilities can be built
 *      and then grafted (Colony.graft) into cells of the next generation.
 *
 *      Biology map:
 *        mRNA program   = registered implementation template (approved by
 *                         the Colony owner - the "transcription factor")
 *        translation    = Clones.clone(program) + delivery receipt
 *        protein orders = queued build jobs the ribosome runs when the
 *                         metabolism activates it each cycle
 *
 *      Nothing here spends cell capital: translation is a gas cost the
 *      triggering keeper is already reimbursed for by the metabolism, so
 *      building proteins is economically free to the cell and paid for by
 *      the expression cycle - exactly how a real ribosome burns ATP rather
 *      than creating it.
 */
contract Ribosome is Organelle {
    uint256 public programCount;
    struct Program {
        address implementation; // the "gene" this cell knows how to express
        string label;
        bool active;
    }
    mapping(uint256 => Program) public programs;

    // delivered products awaiting grafting: instance => program id
    mapping(address => uint256) public builtProduct;
    struct Order {
        uint256 programId;
        bool done;
        bool cancelled;
    }
    Order[] public orders;
    uint256 public ordersHead;
    uint256 public constant MAX_PENDING_ORDERS = 32; // bounded translation queue

    uint256 public proteinsMade;

    event Programmed(uint256 indexed id, address implementation, string label);
    event Ordered(uint256 indexed orderId, uint256 indexed programId);
    event Translated(uint256 indexed orderId, uint256 indexed programId, address product);

    constructor(address colony_) Organelle(colony_) {}

    /// @dev Register an mRNA program. Colony-core only: the cell does not
    ///      invent its own genes; the curator of the species supplies them.
    function program(address implementation, string calldata geneLabel) external onlyCellCore {
        require(implementation.code.length > 0, "Ribosome: program has no code");
        programs[programCount] = Program(implementation, geneLabel, true);
        emit Programmed(programCount, implementation, geneLabel);
        programCount++;
    }

    function toggleProgram(uint256 id) external onlyCellCore {
        require(id < programCount, "Ribosome: no such program");
        programs[id].active = !programs[id].active;
    }

    /// @dev Queue a translation job (cell core, or a service organelle that
    ///      needs a module built for its purpose).
    function order(uint256 programId) external returns (uint256 orderId) {
        require(programs[programId].active, "Ribosome: gene silenced");
        require(orders.length - ordersHead < MAX_PENDING_ORDERS, "Ribosome: translation queue full");
        if (msg.sender != COLONY && !_isMetabolism(msg.sender) && !_isWorkerHere(msg.sender)) {
            revert NotRegisteredHere();
        }
        orders.push(Order(programId, false, false));
        orderId = orders.length - 1;
        emit Ordered(orderId, programId);
    }

    function cancelOrder(uint256 orderId) external onlyCellCore {
        require(orderId >= ordersHead && orderId < orders.length, "Ribosome: no such order");
        orders[orderId].cancelled = true;
    }

    /// @dev Work-cycle hook: translate every pending order. Gas-bounded by
    ///      the caller (metabolism) looping through a capped queue length.
    function act(uint256 budgetWei) external {
        _requireActivation();
        // budget is irrelevant here (no capital moves); it exists so the
        // uniform IWorker interface holds.
        uint256 processed = 0;
        while (ordersHead < orders.length && processed < 8) {
            Order memory o = orders[ordersHead];
            if (!o.cancelled) {
                Program memory p = programs[o.programId];
                if (p.active) {
                    address product = Clones.clone(p.implementation);
                    builtProduct[product] = o.programId;
                    proteinsMade++;
                    emit Translated(ordersHead, o.programId, product);
                }
            }
            ordersHead++;
            processed++;
        }
        emit Activated(budgetWei);
    }

    function ordersPending() external view returns (uint256) {
        return orders.length - ordersHead;
    }

    function _supportsExtra(bytes4 id) internal view override returns (bool) {
        return id == type(IWorker).interfaceId;
    }

    function label() external pure returns (string memory) {
        return "ribosome";
    }
}
