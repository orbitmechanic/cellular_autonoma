// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Organelle} from "./Organelle.sol";
import {INucleus, IEnergyStore} from "../ICell.sol";

interface IShield {
    function screen(address agent) external view returns (bool toxin);
}

/**
 * @title Membrane
 * @dev The cell's surface: selective permeability plus receptors. This is
 *      the INCOME organ - what makes the cell useful to its community, and
 *      what pays for its metabolism.
 *
 *      The cell advertises services (a priced "receptor" per service id).
 *      Anyone - a human wallet, an AI agent, another protocol - binds a
 *      receptor by paying its fee; the fee flows straight into the cell's
 *      EnergyStore as food, attributed per payer (`paidBy`) so the
 *      Peroxisome can quarantine tainted flows and the cell can later offer
 *      volume pricing to its best customers.
 *
 *      Selective permeability:
 *        - closed receptors reject binds,
 *        - a shield (Peroxisome) blocks flagged/toxic agents,
 *        - per-agent rate windows stop griefing/Sybil floods,
 *        - overpayments are refunded (no dust traps).
 *
 *      Also receives passive tips (plain payments forward to the store).
 *      The organelle itself holds no capital at rest.
 */
contract Membrane is Organelle {
    struct Receptor {
        uint96 price; // wei per bind
        bool exists;
        bool open;
        uint32 window; // rate-limit window in seconds
        uint16 maxPerWindow;
    }
    mapping(bytes32 => Receptor) private receptors;
    bytes32[] private _services;

    mapping(address => uint256) public paidBy; // lifetime revenue per agent
    mapping(bytes32 => uint256) public binds; // per-receptor lifetime binds

    // agent => (service => windowStart) and counts
    mapping(address => mapping(bytes32 => uint256)) private _windowStart;
    mapping(address => mapping(bytes32 => uint16)) private _windowCount;

    address public shield; // optional peroxisome

    uint256 public totalBinds;
    uint256 public lifetimeFees;

    event ReceptorRegistered(bytes32 indexed service, uint256 price, uint256 window, uint256 maxPerWindow);
    event ReceptorToggled(bytes32 indexed service, bool open);
    event Bound(address indexed agent, bytes32 indexed service, uint256 fee);
    event ShieldAttached(address indexed shield);

    constructor(address colony_) Organelle(colony_) {}

    // ---- cell-core policy (the cell decides what it sells) ----

    function registerService(bytes32 service, uint96 feeWei, uint32 window, uint16 maxPerWindow) external onlyCellCore {
        require(!receptors[service].exists, "Membrane: receptor exists");
        receptors[service] = Receptor(feeWei, true, true, window, maxPerWindow);
        _services.push(service);
        emit ReceptorRegistered(service, feeWei, window, maxPerWindow);
    }

    function toggleService(bytes32 service) external onlyCellCore {
        require(receptors[service].exists, "Membrane: no such receptor");
        receptors[service].open = !receptors[service].open;
        emit ReceptorToggled(service, receptors[service].open);
    }

    /// @dev Attach the toxin shield (peroxisome). Zero detaches.
    function attachShield(address shield_) external onlyCellCore {
        shield = shield_;
        emit ShieldAttached(shield_);
    }

    // ---- the outside world uses the cell ----

    /// @dev Bind a receptor: pay the fee, receive the service receipt event.
    ///      What the service actually delivers is the consuming organelle's
    ///      business (escrow slot, attestation, registry entry, keeper
    ///      subscription...) - the Membrane is the metering gateway.
    function bind(bytes32 service) external payable returns (uint256 fee) {
        // a lysosome-recycled (deregistered) membrane detaches: it may no
        // longer collect fees on behalf of the cell.
        require(INucleus(_nucleus).getRole(address(this)) != INucleus.Role.NONE, "Membrane: detached from the cell");
        Receptor storage r = receptors[service];
        require(r.open, "Membrane: receptor closed");
        if (shield != address(0)) {
            require(!IShield(shield).screen(msg.sender), "Membrane: agent screened out");
        }
        // selective permeability: rate windows
        if (r.window > 0 && r.maxPerWindow > 0) {
            if (block.timestamp >= _windowStart[msg.sender][service] + r.window) {
                _windowStart[msg.sender][service] = block.timestamp;
                _windowCount[msg.sender][service] = 0;
            }
            require(_windowCount[msg.sender][service] < r.maxPerWindow, "Membrane: rate window full");
            unchecked {
                _windowCount[msg.sender][service]++;
            }
        }
        fee = r.price;
        require(msg.value >= fee, "Membrane: fee underpaid");
        paidBy[msg.sender] += fee;
        binds[service]++;
        totalBinds++;
        lifetimeFees += fee;

        // forward fees home (EnergyStore.receive attributes Fed to the membrane)
        IEnergyStore store = _store();
        Address.sendValue(payable(address(store)), fee);
        if (msg.value > fee) {
            Address.sendValue(payable(msg.sender), msg.value - fee);
        }
        emit Bound(msg.sender, service, fee);
    }

    function price(bytes32 service) external view returns (uint256) {
        return receptors[service].price;
    }

    function isOpen(bytes32 service) external view returns (bool) {
        return receptors[service].open;
    }

    function serviceAt(uint256 i) external view returns (bytes32) {
        return _services[i];
    }

    function serviceCount() external view returns (uint256) {
        return _services.length;
    }

    /// @dev Passive tip jar: anything sent to the membrane flows to the cell.
    receive() external payable override {
        if (msg.value > 0) {
            Address.sendValue(payable(address(_store())), msg.value);
        }
    }

    function label() external pure returns (string memory) {
        return "membrane";
    }
}
