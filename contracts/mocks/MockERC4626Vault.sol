// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC4626} from "../v2/IERCs.sol";

/**
 * @title MockERC4626Vault
 * @dev A toy-but-standard ERC-4626 vault for the test organism, replacing
 *      v2.1's bespoke MockYieldVault. Two deliberate teaching properties:
 *
 *      1. YIELD = DONATIONS. totalAssets() is the raw ETH balance, so any
 *         external payment to the vault raises every share's value - the
 *         simplest honest accrual model. (Real venues compute interest
 *         from borrowers; the Mitochondrion cannot tell the difference,
 *         which is the point of the standard.)
 *      2. VIRTUAL SHARES + VIRTUAL ASSETS offsets (EIP-4626 security
 *         consideration / Solmate-style defense) blunt the classic
 *         first-depositor donation/inflation attack: an attacker cannot
 *         donate to round shares up to zero and steal a later depositor's
 *         assets, because the conversion denominators never reach zero.
 *
 *      Still a MOCK: no operators/approvals on withdraw, no fee-on-transfer
 *         asset, share balances are internal (not an ERC-20). Production
 *         cells should face Aave v3 / Morpho / a canonical ERC-4626 only.
 */
contract MockERC4626Vault is IERC4626 {
    using Math for uint256;

    uint256 private constant VIRTUAL_SHARES = 1e3;
    uint256 private constant VIRTUAL_ASSETS = 1e3; // OZ-style offset on BOTH sides

    uint256 public totalShares;
    mapping(address => uint256) public balanceOf;

    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    function asset() external view returns (address) {
        return address(this); // sentinel: "the asset is wrapped native ETH"
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function totalAssets() public view returns (uint256) {
        return address(this).balance;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return assets.mulDiv(totalShares + VIRTUAL_SHARES, totalAssets() + VIRTUAL_ASSETS, Math.Rounding.Floor);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return shares.mulDiv(totalAssets() + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES, Math.Rounding.Floor);
    }

    function maxDeposit(address) external view returns (uint256) {
        return type(uint128).max;
    }

    function previewDeposit(uint256 assets) external view returns (uint256) {
        return convertToShares(assets);
    }

    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares) {
        require(msg.value == assets, "Vault: exact value required");
        // price MUST be evaluated BEFORE the inflow counts (matches the
        // preview* views and standard ERC-4626 asset-pull semantics)
        shares = assets.mulDiv(totalShares + VIRTUAL_SHARES, address(this).balance - msg.value + VIRTUAL_ASSETS, Math.Rounding.Floor);
        unchecked {
            totalShares += shares;
        }
        balanceOf[receiver] += shares;
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function maxWithdraw(address owner) public view returns (uint256) {
        uint256 redeemable = convertToAssets(balanceOf[owner]);
        uint256 bal = address(this).balance;
        return redeemable > bal ? bal : redeemable;
    }

    function previewWithdraw(uint256 assets) external view returns (uint256) {
        return _toSharesCeil(assets);
    }

    /// @dev round shares UP: claimer gives slightly more shares than exact,
    ///      protecting the vault from dust-extraction via repeated withdrawals
    function _toSharesCeil(uint256 assets) private view returns (uint256) {
        return assets.mulDiv(totalShares + VIRTUAL_SHARES, totalAssets() + VIRTUAL_ASSETS, Math.Rounding.Ceil);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        require(owner == msg.sender, "Vault: no operators in mock");
        require(assets <= maxWithdraw(owner), "Vault: insufficient assets");
        shares = _toSharesCeil(assets);
        balanceOf[owner] -= shares;
        totalShares -= shares;
        Address.sendValue(payable(receiver), assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function maxRedeem(address owner) external view returns (uint256) {
        return balanceOf[owner];
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        require(owner == msg.sender, "Vault: no operators in mock");
        assets = previewRedeem(shares);
        require(assets <= address(this).balance, "Vault: insolvent");
        balanceOf[owner] -= shares;
        totalShares -= shares;
        Address.sendValue(payable(receiver), assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /// @dev Simulate a protocol loss to exercise the cell's resilience.
    function drain(uint256 amount) external {
        require(amount <= address(this).balance, "Vault: nothing left");
        Address.sendValue(payable(msg.sender), amount);
    }

    receive() external payable {} // donations = yield
}
