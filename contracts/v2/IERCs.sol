// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/**
 * @dev Standard ERC/EIP interfaces adopted by the v2.2 refactor.
 *
 * Rationale (full matrix in AUDIT.md / DESIGN.md):
 *  - ERC-165 (Final): interface detection, so the cell can REJECT modules
 *    that do not speak the protocol it is about to call them with
 *    (a WORKER graft must prove it implements IWorker; a shield must
 *    prove it implements IPeroxisome).
 *  - ERC-4626 (Final): the yield-venue standard. The Mitochondrion now
 *    speaks pure ERC-4626 (deposit/withdraw/preview/max*) instead of a
 *    bespoke IYield, so ANY compliant vault (Aave, Morpho, LST wrappers)
 *    is a drop-in respiratory substrate. The vault mock implements the
 *    virtual-shares/offsets defense the standard's security section calls
 *    for (donation/inflation attacks).
 *  - ERC-8004 (Draft, mainnet-live Jan 2026): agent discovery registries.
 *    Cells do NOT implement the registry (it is a chain singleton other
 *    parties run) — instead the Membrane gains a registration surface so a
 *    cell's services are describable in an 8004 registration file, letting
 *    the agent economy find and pay cells.
 */

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IERC4626 {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function decimals() external view returns (uint8);
    function balanceOf(address owner) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function maxDeposit(address receiver) external view returns (uint256);
    function previewDeposit(uint256 assets) external view returns (uint256);
    /// @dev DEVIATION from strict ERC-4626: marked `payable` because the
    ///      cell's substrate is native ETH. For token vaults (Aave, Morpho)
    ///      a thin wrapper does approve-then-deposit with zero value; the
    ///      Mitochondrion never distinguishes - that is the point of the
    ///      standard's read surface being the same either way.
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);
    function maxWithdraw(address owner) external view returns (uint256);
    function previewWithdraw(uint256 assets) external view returns (uint256);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function previewRedeem(uint256 shares) external view returns (uint256);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
}

/// @dev Minimal read-surface a Peroxisome must expose for a Membrane to trust it as a shield.
interface IPeroxisome {
    function screen(address agent) external view returns (bool toxin);
}

interface IMembrane8004 {
    /// @dev ERC-8004-style discovery: a human/agent-readable name for this cell's service surface.
    function agentName() external view returns (string memory);
    /// @dev URI (ipfs://, https://, data:) pointing at the agent registration file
    ///      advertised in an ERC-8004 Identity Registry tokenURI.
    function registrationURI() external view returns (string memory);
}
