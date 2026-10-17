// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Organelle} from "./Organelle.sol";
import {INucleus, IEnergyStore} from "../ICell.sol";

/// @dev The minimal surface of an external yield venue (Aave-style money
///      market, LST pool, LP position ...). Kept deliberately small so real
///      protocol adapters can be dropped in later without touching the cell.
interface IYield {
    function deposit(address beneficiary) external payable;
    function withdraw(address to, uint256 assets) external;
    function assetsOf(address beneficiary) external view returns (uint256);
}

/**
 * @title Mitochondrion
 * @dev The powerhouse of the cell: converts idle capital into ATP (income)
 *      through respiration. This is the INTERNAL half of metabolism - where
 *      the Membrane earns from the outside world, the mitochondrion grows
 *      what the cell already has.
 *
 *      Each activation cycle (Chloroplast.express -> act(budget)):
 *        1. if the external venue holds more than the staking target, the
 *           excess is unstaked home to the EnergyStore (liquidity first),
 *        2. accrued yield above principal is harvested to the EnergyStore
 *           (income lands as FOOD, credited to this organelle),
 *        3. if the cell holds more than its operating float, the surplus up
 *           to the budget is pulled via the cycle ceiling and re-deposited.
 *
 *      Capital only ever moves against the metered authorization minted by
 *      the metabolism this cycle - the organelle cannot out-spend the cell's
 *      intent, and cannot touch keeper-reserved credit at all (spend draws
 *      from the discretionary balance only).
 */
contract Mitochondrion is Organelle {
    address public vault; // external yield venue
    uint16 public stakeTargetBps = 5000; // hold up to 50% of the cell's balance staked
    uint16 public minFloatBps = 3000; // never unstake below 30% held in-cell (operating float)
    uint16 public deployFloorBps = 250; // don't breathe over dust: only deploy when store > 2.5% above target*balance

    uint256 public principal; // wei we've pushed into the vault (for yield accounting)

    event Respired(uint256 deposited);
    event ATPHarvested(uint256 assets);
    event Retired(uint256 assets);
    event VenueConfigured(address vault, uint16 stakeTargetBps, uint16 minFloatBps);

    constructor(address colony_) Organelle(colony_) {}

    /// @dev Configure the venue + posture. Cell-core policy, not worker action.
    function configure(address vault_, uint16 stakeTargetBps_, uint16 minFloatBps_) external onlyCellCore {
        require(stakeTargetBps_ <= 9000 && minFloatBps_ <= 9000, "Mitochondrion: bps too hot");
        vault = vault_;
        stakeTargetBps = stakeTargetBps_;
        minFloatBps = minFloatBps_;
        emit VenueConfigured(vault_, stakeTargetBps_, minFloatBps_);
    }

    function act(uint256 budgetWei) external {
        _requireActivation();
        IEnergyStore store = _store();
        uint256 inCell = store.getBalance();
        uint256 staked = vault == address(0) ? 0 : IYield(vault).assetsOf(address(this));
        uint256 total = inCell + staked;

        if (vault != address(0)) {
            // 1. harvest ATP (assets above principal) home as income
            if (staked > principal) {
                uint256 yield_ = staked - principal;
                IYield(vault).withdraw(address(store), yield_);
                emit ATPHarvested(yield_);
                staked = IYield(vault).assetsOf(address(this));
                inCell = store.getBalance();
                total = inCell + staked;
            }

            // 2. if over target or liquidity is tight, breathe out
            uint256 target = (total * stakeTargetBps) / 10000;
            if (staked > target || inCell < (total * minFloatBps) / 10000) {
                uint256 needHome = staked - target;
                uint256 floatTarget = (total * minFloatBps) / 10000;
                if (inCell < floatTarget) {
                    uint256 extra = floatTarget - inCell;
                    needHome = extra > needHome ? extra : needHome;
                    if (needHome > staked) needHome = staked;
                }
                if (needHome > 0) {
                    IYield(vault).withdraw(address(store), needHome);
                    principal = principal > needHome ? principal - needHome : 0;
                    emit Retired(needHome);
                }
            }

            // 3. otherwise deploy surplus into respiration, against the cycle ceiling
            inCell = store.getBalance();
            staked = IYield(vault).assetsOf(address(this));
            total = inCell + staked;
            target = (total * stakeTargetBps) / 10000;
            if (staked < target) {
                uint256 want = target - staked;
                // keep the in-cell float: only deploy the part above minFloat
                uint256 floatFloor = (total * minFloatBps) / 10000;
                uint256 deployable = inCell > floatFloor ? inCell - floatFloor : 0;
                if (want > deployable) want = deployable;
                if (want > budgetWei) want = budgetWei;
                uint256 ceiling = store.cycleCeiling(address(this));
                if (want > ceiling) want = ceiling;
                if (want > 0) {
                    store.spend(payable(address(this)), want);
                    IYield(vault).deposit{value: want}(address(this));
                    principal += want;
                    emit Respired(want);
                }
            }
        }
        emit Activated(budgetWei);
    }

    function label() external pure returns (string memory) {
        return "mitochondrion";
    }
}
