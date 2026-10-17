// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @dev Shared interfaces for the v2 cell system. Roles replace v1's
///      free-form name lookups: an organelle's authority comes from its role,
///      and unknown addresses resolve to NONE instead of reverting.
interface INucleus {
    enum Role {
        NONE, // caller not registered in this cell
        NUCLEUS, // the nucleus itself
        ENERGY, // capital storage (EnergyStore)
        METABOLISM, // replication + keeper reimbursement (Chloroplast)
        RESERVE, // long-horizon capital (staking/yield modules later)
        OTHER // service organelles (membrane, ribosome, ... later)
    }

    struct Organelle {
        address instance; // live contract bound to THIS cell
        address template; // implementation to clone from at mitosis (never an instance)
        Role role;
        bool replicable; // true: daughter gets its own clone; false: shared pointer copied
    }

    function name() external view returns (string memory);
    function serial() external view returns (uint256);
    function generation() external view returns (uint16);
    function parentCell() external view returns (address);
    function colony() external view returns (address);
    function alive() external view returns (bool);
    function getRole(address organelleAddress) external view returns (Role);
    function getOrganelleByRole(Role r) external view returns (address);
    function childrenLength() external view returns (uint256);
    function children(uint256 i) external view returns (address);
    function organelleCount() external view returns (uint256);
    function organelleAt(uint256 i) external view returns (Organelle memory);
    function organelleByName(string calldata n) external view returns (Organelle memory);
    function organelleNames() external view returns (string[] memory);
}

interface IEnergyStore {
    function getBalance() external view returns (uint256);
    function available() external view returns (uint256);
    function outstandingCredits() external view returns (uint256);
    function creditedBy(address who) external view returns (uint256);
    function totalFood() external view returns (uint256);
    function claimable(address who) external view returns (uint256);
    /// @dev Pull payment used by Colony during mitosis and harvest.
    function withdraw(address payable recipient, uint256 amount) external;
    /// @dev Credit a keeper's earned reimbursement (pull pattern, no value sent).
    function creditCaller(address who, uint256 amount) external;
    /// @dev Keeper (or any credited party) collects its accrued reimbursement.
    function claim(address payable who, uint256 amount) external;
    /// @dev Colony-only: push capital upward to `destination` (the parent
    ///      cell's energy store, or the colony harvest recipient for root).
    function remitUp(address destination, uint256 amount) external;
}

interface IChloroplastV2 {
    function nucleus() external view returns (address);
}

/// @dev Surface the Chloroplast needs from the Colony to gate and execute
///      mitosis with the colony-wide economics.
interface IColony {
    function birth(address parent, uint256 endowment) external returns (address);
    function maxGeneration() external view returns (uint16);
    function minBirthInterval() external view returns (uint256);
    function minReserve() external view returns (uint256);
    function keeperStipend() external view returns (uint256);
    function birthGasBudget() external view returns (uint256);
    function maxRefundBps() external view returns (uint16);
    function maxRefundCap() external view returns (uint256);
    function birthFee() external view returns (uint256);
}
