// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Organelle} from "./Organelle.sol";
import {INucleus, IEnergyStore, IWorker} from "../ICell.sol";
import {IERC4626} from "../IERCs.sol";

/**
 * @title Mitochondrion
 * @dev The powerhouse of the cell: converts idle capital into ATP (income)
 *      through respiration. This is the INTERNAL half of metabolism - where
 *      the Membrane earns from the outside world, the mitochondrion grows
 *      what the cell already has.
 *
 *      v2.2: speaks the ERC-4626 vault standard (was a bespoke IYield), so
 *      ANY compliant venue - Aave, Morpho, an LST wrapper - is a drop-in
 *      respiratory substrate with zero cell changes. `principal` is the cost
 *      basis in assets; the invariant yield == stakedAssets() - principal is
 *      kept exact by only withdrawing yield for harvest and retiring basis
 *      1:1 for principal redemptions - share-proportional accounting (with
 *      its rounding drift) is unnecessary in asset space.
 *
 *      Each activation cycle (Chloroplast.express -> act(budget)):
 *        1. harvest ATP: yield above basis is withdrawn STRAIGHT to the
 *           EnergyStore as food, bounded by maxWithdraw (venue liquidity),
 *        2. if over the staking target or the in-cell float is tight, the
 *           excess breathes out (unstakes) to the EnergyStore,
 *        3. surplus beyond the operating float is deployed against the
 *           cycle ceiling, the venue's maxDeposit, and the target.
 *
 *      Capital only ever moves against the metered authorization minted by
 *      the metabolism this cycle - the organelle cannot out-spend the cell's
 *      intent, and cannot touch keeper-reserved credit at all (spend draws
 *      from the discretionary balance only).
 */
contract Mitochondrion is Organelle {

    IERC4626 public vault; // external ERC-4626 yield venue
    uint16 public stakeTargetBps = 5000; // hold up to 50% of the cell's assets staked
    uint16 public minFloatBps = 3000; // never leave in-cell float under 30% of assets

    uint256 public principal; // cost basis (wei) of shares currently held

    event Respired(uint256 assets, uint256 shares);
    event ATPHarvested(uint256 assets);
    event Retired(uint256 assets, uint256 shares);
    event VenueConfigured(address vault, uint16 stakeTargetBps, uint16 minFloatBps);

    constructor(address colony_) Organelle(colony_) {}

    /// @dev Configure the venue + posture. Cell-core policy, not worker action.
    function configure(address vault_, uint16 stakeTargetBps_, uint16 minFloatBps_) external onlyCellCore {
        require(stakeTargetBps_ <= 9000 && minFloatBps_ <= 9000, "Mitochondrion: bps too hot");
        require(vault_.code.length > 0, "Mitochondrion: venue has no code");
        vault = IERC4626(vault_);
        stakeTargetBps = stakeTargetBps_;
        minFloatBps = minFloatBps_;
        emit VenueConfigured(vault_, stakeTargetBps_, minFloatBps_);
    }

    function sharesHeld() public view returns (uint256) {
        return address(vault) == address(0) ? 0 : vault.balanceOf(address(this));
    }

    function stakedAssets() public view returns (uint256) {
        return address(vault) == address(0) ? 0 : vault.previewRedeem(sharesHeld());
    }

    function act(uint256 budgetWei) external {
        _requireActivation();
        IEnergyStore store = _store();

        if (address(vault) != address(0)) {
            // 1. harvest ATP (assets above cost basis) home as food.
            //    Withdrawing yield does NOT touch the basis: the invariant
            //    `yield == staked - principal` holds exactly in asset space,
            //    which is why no share-proportional basis math is needed.
            uint256 staked = stakedAssets();
            if (staked > principal) {
                uint256 yield_ = staked - principal;
                uint256 liquid = vault.maxWithdraw(address(this));
                uint256 take = yield_ > liquid ? liquid : yield_;
                if (take > 0) {
                    vault.withdraw(take, address(store), address(this));
                    emit ATPHarvested(take);
                }
            }

            // 2. breathe out when over target or when the cell needs float.
            //    Principal redemptions retire basis 1:1 (clamped) - any
            //    slippage re-prices into `yield` and gets harvested next
            //    cycle; nothing is ever double-counted.
            uint256 inCell = store.getBalance();
            staked = stakedAssets();
            uint256 total = inCell + staked;
            uint256 target = (total * stakeTargetBps) / 10000;
            uint256 floatFloor = (total * minFloatBps) / 10000;
            {
                uint256 needHome = 0;
                uint256 over = staked > target ? staked - target : 0;
                uint256 shortFloat = inCell < floatFloor ? floatFloor - inCell : 0;
                needHome = over > shortFloat ? over : shortFloat;
                uint256 liquid = vault.maxWithdraw(address(this));
                uint256 take = needHome > liquid ? liquid : needHome;
                if (take > 0) {
                    uint256 sharesBefore = sharesHeld();
                    vault.withdraw(take, address(store), address(this));
                    if (take <= principal) {
                        principal -= take;
                    } else {
                        emit ATPHarvested(take - principal); // excess was yield
                        principal = 0;
                    }
                    emit Retired(take, sharesBefore - sharesHeld());
                }
            }

            // 3. deploy surplus into respiration (bounded 4 ways).
            inCell = store.getBalance();
            total = inCell + stakedAssets();
            target = (total * stakeTargetBps) / 10000;
            uint256 stakedNow = stakedAssets();
            if (target > stakedNow) {
                uint256 want = target - stakedNow;
                uint256 floatFloor2 = (total * minFloatBps) / 10000;
                uint256 deployable = inCell > floatFloor2 ? inCell - floatFloor2 : 0;
                if (want > deployable) want = deployable;
                if (want > budgetWei) want = budgetWei;
                uint256 ceiling = store.cycleCeiling(address(this));
                if (want > ceiling) want = ceiling;
                uint256 venueRoom = vault.maxDeposit(address(this));
                if (want > venueRoom) want = venueRoom;
                if (want > 0) {
                    store.spend(payable(address(this)), want);
                    uint256 sharesOut = vault.deposit{value: want}(want, address(this));
                    principal += want;
                    emit Respired(want, sharesOut);
                }
            }
        }
        emit Activated(budgetWei);
    }

    function _supportsExtra(bytes4 id) internal view override returns (bool) {
        return id == type(IWorker).interfaceId;
    }

    function label() external pure returns (string memory) {
        return "mitochondrion";
    }
}
