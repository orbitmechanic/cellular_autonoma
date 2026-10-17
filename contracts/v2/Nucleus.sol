// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {INucleus} from "./ICell.sol";

/**
 * @title Nucleus (v2)
 * @dev A cell's identity and organelle registry.
 *
 * Fixes over v1:
 *  - Numeric `serial` + `generation` instead of an ever-growing
 *    "copy copy copy" string (v1's identity bloated 5 bytes per generation).
 *  - Organelle records keep BOTH the live instance and the template address,
 *    so mitosis always clones from the template. v1 cloned live instances,
 *    producing a proxy chain one hop deeper per generation (inherited gas
 *    bloat).
 *  - Roles (`Role`) give capability checks without reverting on unknown
 *    addresses. v1's onlyCellMember modifier called getOrganelleName(), which
 *    reverted for non-members, so the intended check never behaved as written.
 *  - Lineage is tracked in BOTH directions (parentCell + children[]), which is
 *    what makes colony-wide harvest possible. v1 had no child registry on the
 *    Nucleus at all.
 *  - No more permissionless cloneCell(). Only the Colony (the mitosis engine)
 *    may initialize or mutate a nucleus; v1's cloneCell() let anyone mint
 *    identity clones for free.
 */
contract Nucleus is Initializable {
    string private _displayName;
    uint256 private _serial;
    uint16 private _generation;
    address private _parentCell;
    bool private _alive; // set in initialize(); storage initializers do NOT run in clones

    struct Entry {
        INucleus.Organelle data;
        uint256 indexPlusOne; // 0 = absent; otherwise array index + 1
    }

    string[] private _names;
    mapping(bytes32 => Entry) private _byName;
    mapping(address => bytes32) private _byAddress;
    address[] private _children;

    address public immutable COLONY;

    event OrganelleRegistered(string name, address instance, address template, INucleus.Role role, bool replicable);
    event ChildBorn(address childNucleus, uint256 childSerial, uint16 childGeneration);
    event Apoptosis(address triggeredBy);

    error OnlyColony();
    error AlreadyInitialized();

    constructor(address colony_) {
        COLONY = colony_;
    }

    function initialize(
        string calldata displayName,
        uint256 serial_,
        uint16 generation_,
        address parentCell_,
        string[] calldata names,
        address[] calldata instances,
        address[] calldata templates,
        uint8[] calldata roles,
        bool[] calldata replicable
    ) external {
        // v1 allowed any caller; v2 binds genesis to the Colony only.
        if (msg.sender != COLONY) revert OnlyColony();
        // Proxies start with fresh storage (_initialized == 0), so this flag
        // check is per-cell and cannot be replayed.
        if (_serial != 0) revert AlreadyInitialized();
        require(names.length == instances.length && names.length == templates.length && names.length == roles.length && names.length == replicable.length, "Nucleus: array length mismatch");

        _displayName = displayName;
        _serial = serial_;
        _generation = generation_;
        _parentCell = parentCell_;
        _alive = true; // proxy clones never ran a constructor

        // Self-registration: the Nucleus is an organelle of its own cell.
        // The clone's EIP-1967 implementation slot IS the template address.
        _register("nucleus", address(this), ERC1967Utils.getImplementation(), uint8(INucleus.Role.NUCLEUS), true);

        // Register the daughter's organelle set (assembled by the Colony).
        for (uint256 i = 0; i < names.length; i++) {
            require(instances[i] != address(0), "Nucleus: zero instance");
            _register(names[i], instances[i], templates[i], roles[i], replicable[i]);
        }
    }

    modifier onlyColony() {
        if (msg.sender != COLONY) revert OnlyColony();
        _;
    }

    function _register(string memory n, address instance, address template, uint8 role, bool replicable) private {
        bytes32 key = keccak256(bytes(n));
        INucleus.Role r = INucleus.Role(role);
        if (_byName[key].indexPlusOne != 0) {
            // Re-registration replaces the instance but keeps array position.
            Entry storage e = _byName[key];
            delete _byAddress[e.data.instance];
            e.data = INucleus.Organelle({instance: instance, template: template, role: r, replicable: replicable});
            _byAddress[instance] = key;
        } else {
            _names.push(n);
            _byName[key] = Entry(INucleus.Organelle({instance: instance, template: template, role: r, replicable: replicable}), _names.length);
            _byAddress[instance] = key;
        }
        emit OrganelleRegistered(n, instance, template, r, replicable);
    }

    /// @dev Colony-only: graft a new/updated organelle onto a living cell
    ///      (symbiosis hook for service modules joining an existing lineage
    ///      member). v1's registerOrganelle let the Parent address (an EOA in
    ///      early tests) point roles at arbitrary addresses; v2 routes all
    ///      registry mutation through the Colony so role binding is audited.
    function graftExternal(string calldata n, address instance, address template, uint8 role, bool replicable) external onlyColony {
        require(instance != address(0), "Nucleus: zero instance");
        _register(n, instance, template, role, replicable);
    }

    /// @dev Colony-only: record a daughter cell after successful mitosis.
    function registerChild(address childNucleus) external onlyColony {
        _children.push(childNucleus);
        emit ChildBorn(childNucleus, Nucleus(childNucleus).serial(), Nucleus(childNucleus).generation());
    }

    /// @dev Colony-only: Colony-driven death. Capital is swept by the Colony
    ///      before this is called; an unregistered cell keeps its balance, so
    ///      callers should never mark a cell dead with funds in it.
    function setDead() external onlyColony {
        _alive = false;
        emit Apoptosis(msg.sender);
    }

    // ---- views ----

    function name() external view returns (string memory) {
        return _displayName;
    }

    function serial() external view returns (uint256) {
        return _serial;
    }

    function generation() external view returns (uint16) {
        return _generation;
    }

    function parentCell() external view returns (address) {
        return _parentCell;
    }

    function colony() external view returns (address) {
        return COLONY;
    }

    function alive() external view returns (bool) {
        return _alive;
    }

    function _entryAt(bytes32 key) private view returns (INucleus.Organelle storage) {
        Entry storage e = _byName[key];
        require(e.indexPlusOne != 0, "Nucleus: organelle not found");
        return e.data;
    }

    /// @dev Non-reverting capability check. v1's equivalent reverted, which
    ///      made modifiers like onlyCellMember behave incorrectly.
    function getRole(address organelleAddress) external view returns (INucleus.Role) {
        bytes32 key = _byAddress[organelleAddress];
        if (key == bytes32(0) || _byName[key].indexPlusOne == 0 || _byName[key].data.instance != organelleAddress) {
            return INucleus.Role.NONE;
        }
        return _byName[key].data.role;
    }

    function getOrganelleName(address organelleAddress) external view returns (string memory) {
        bytes32 key = _byAddress[organelleAddress];
        require(key != bytes32(0) && _byName[key].indexPlusOne != 0, "Nucleus: organelle not found");
        return _names[_byName[key].indexPlusOne - 1];
    }

    function getOrganelleByRole(INucleus.Role r) public view returns (address) {
        for (uint256 i = 0; i < _names.length; i++) {
            INucleus.Organelle storage o = _byName[keccak256(bytes(_names[i]))].data;
            if (o.role == r && o.instance != address(0)) return o.instance;
        }
        return address(0);
    }

    /// @dev Non-reverting role test (capability checks in aux organelles).
    function hasRole(address a, INucleus.Role r) external view returns (bool) {
        bytes32 key = _byAddress[a];
        if (key == bytes32(0) || _byName[key].indexPlusOne == 0) return false;
        INucleus.Organelle storage o = _byName[key].data;
        return o.instance == a && o.role == r;
    }

    /// @dev Organelles the metabolism activates each cycle (Role.WORKER).
    function workersCount() external view returns (uint256) {
        uint256 c = 0;
        for (uint256 i = 0; i < _names.length; i++) {
            INucleus.Organelle storage o = _byName[keccak256(bytes(_names[i]))].data;
            if (o.role == INucleus.Role.WORKER && o.instance != address(0)) c++;
        }
        return c;
    }

    function workerAt(uint256 idx) external view returns (address) {
        uint256 c = 0;
        for (uint256 i = 0; i < _names.length; i++) {
            INucleus.Organelle storage o = _byName[keccak256(bytes(_names[i]))].data;
            if (o.role == INucleus.Role.WORKER && o.instance != address(0)) {
                if (c == idx) return o.instance;
                c++;
            }
        }
        return address(0);
    }

    /// @dev Snapshot array the metabolism iterates over during a cycle.
    function workerList() external view returns (address[] memory) {
        uint256 c = 0;
        uint256 i;
        for (i = 0; i < _names.length; i++) {
            INucleus.Organelle storage o = _byName[keccak256(bytes(_names[i]))].data;
            if (o.role == INucleus.Role.WORKER && o.instance != address(0)) c++;
        }
        address[] memory out = new address[](c);
        uint256 j = 0;
        for (i = 0; i < _names.length; i++) {
            INucleus.Organelle storage o = _byName[keccak256(bytes(_names[i]))].data;
            if (o.role == INucleus.Role.WORKER && o.instance != address(0)) out[j++] = o.instance;
        }
        return out;
    }

    /// @dev Lysosome/Colony reclamation: tombstone an aux organelle so the
    ///      metabolism stops activating it. Core roles can never be removed.
    function unregisterAux(string calldata n) external {
        bool core = msg.sender == COLONY;
        if (!core) {
            bytes32 callerKey = _byAddress[msg.sender];
            if (callerKey == bytes32(0) || _byName[callerKey].indexPlusOne == 0) revert OnlyColony();
            INucleus.Organelle storage caller = _byName[callerKey].data;
            if (caller.instance != msg.sender || caller.role != INucleus.Role.WORKER) revert OnlyColony();
        }
        bytes32 key = keccak256(bytes(n));
        require(_byName[key].indexPlusOne != 0, "Nucleus: not registered");
        INucleus.Organelle storage o = _byName[key].data;
        require(
            o.role == INucleus.Role.WORKER || o.role == INucleus.Role.OTHER || o.role == INucleus.Role.RESERVE,
            "Nucleus: core organelles are permanent"
        );
        delete _byAddress[o.instance];
        o.instance = address(0);
        o.template = address(0);
        emit OrganelleRegistered(n, address(0), address(0), INucleus.Role.NONE, false);
    }

    function organelleCount() external view returns (uint256) {
        return _names.length;
    }

    function organelleAt(uint256 i) external view returns (INucleus.Organelle memory) {
        return _entryAt(keccak256(bytes(_names[i])));
    }

    function organelleByName(string calldata n) external view returns (INucleus.Organelle memory) {
        return _entryAt(keccak256(bytes(n)));
    }

    function organelleNames() external view returns (string[] memory) {
        return _names;
    }

    function childrenLength() external view returns (uint256) {
        return _children.length;
    }

    function children(uint256 i) external view returns (address) {
        return _children[i];
    }
}
