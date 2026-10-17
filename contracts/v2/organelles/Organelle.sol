// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {INucleus, IEnergyStore} from "../ICell.sol";
import {IERC165} from "../IERCs.sol";

/**
 * @title Organelle (base)
 * @dev Shared skeleton for the optional organelle cast (v2.1): mitochondrion,
 *      ribosome, Golgi, lysosome, peroxisome, vacuole, membrane.
 *
 *      Every organelle is a CLONE-ABLE template bound to one colony (immutable,
 *      set by the Colony at template deploy — same discipline as the core trio),
 *      initialized once with the nucleus it joins, and can only act with the
 *      authority its registration in THAT nucleus grants. A rogue clone wired
 *      at a foreign nucleus simply has no role there and can do nothing —
 *      capability lives in the registry, not in the contract.
 */
abstract contract Organelle is Initializable {
    address internal _nucleus;
    address public immutable COLONY;

    event Activated(uint256 budget);

    error NotRegisteredHere();
    error NotCellsMetabolism();

    constructor(address colony_) {
        COLONY = colony_;
        _disableInitializers();
    }

    /// @dev The Colony binds a clone to its cell. Restricted to the Colony
    ///      (audit fix v2.2): a template clone may otherwise be front-run by
    ///      an attacker who initializes it against a rogue "nucleus" before
    ///      grafting - the graft would then install an organ wired to the
    ///      wrong body. Only the assembler may do the wiring.
    function initialize(address nucleus_) external initializer {
        require(msg.sender == COLONY, "Organelle: only the colony may bind a clone");
        _nucleus = nucleus_;
    }

    function nucleus() external view returns (address) {
        return _nucleus;
    }

    /**
     * @dev ERC-165 interface detection (v2.2). The registry gate in
     *      Nucleus.graftExternal requires any Role.WORKER instance to
     *      supportsInterface(type(IWorker).interfaceId), so a module that
     *      cannot answer act() is rejected before it is ever activated.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return interfaceId == type(IERC165).interfaceId || _supportsExtra(interfaceId);
    }

    /// @dev Subclass hook: workers list type(IWorker).interfaceId here.
    function _supportsExtra(bytes4) internal view virtual returns (bool) {
        return false;
    }

    /// @dev Guards the act() entry point: only the cell's own metabolism (or
    ///      the Colony) may activate this organelle, and this clone must
    ///      currently be registered here as a WORKER. A recycled/deregistered
    ///      organelle loses all capability immediately, without any state to
    ///      clean up - the registry IS the capability.
    function _requireActivation() internal view {
        if (!_isMetabolism(msg.sender) && msg.sender != COLONY) revert NotCellsMetabolism();
        if (!_isWorkerHere(address(this))) revert NotRegisteredHere();
    }

    function _isWorkerHere(address a) internal view returns (bool) {
        return INucleus(_nucleus).hasRole(a, INucleus.Role.WORKER);
    }

    function _isMetabolism(address a) internal view returns (bool) {
        return INucleus(_nucleus).getRole(a) == INucleus.Role.METABOLISM;
    }

    /// @dev Core organelles (METABOLISM) or the Colony configure auxiliary
    ///      organelles - the cell's "nervous system" sets policy here.
    modifier onlyCellCore() {
        if (msg.sender != COLONY && !_isMetabolism(msg.sender)) revert NotCellsMetabolism();
        _;
    }

    function _store() internal view returns (IEnergyStore) {
        return IEnergyStore(INucleus(_nucleus).getOrganelleByRole(INucleus.Role.ENERGY));
    }

    /// @dev Base accepts inbound capital (worker cycle proceeds); subclasses
    ///      with custom intake logic override this.
    receive() external payable virtual {}
}
