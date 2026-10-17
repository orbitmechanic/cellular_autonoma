// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {INucleus, IEnergyStore} from "./ICell.sol";
import {Nucleus} from "./Nucleus.sol";
import {EnergyStore} from "./EnergyStore.sol";
import {Chloroplast} from "./Chloroplast.sol";

/**
 * @title Colony
 * @dev The mitosis engine and the root owner's control surface. One Colony
 *      deployment = one species: it owns the three organelle templates
 *      (deployed in its own constructor, so templates and colony are bound
 *      immutably) and enforces the economics of division.
 *
 * Why the Colony exists: the cell can never send its own transaction, so
 * external triggers (keepers/agents) run replicate() and get reimbursed. But
 * the actual *construction* of a daughter cell needs a neutral assembler that
 * both parent and child trust to wire them honestly. The Colony is that
 * assembler, and it is also the answer to v1's biggest product gap:
 * capital was never harvestable to the root deployer. Here it is:
 *   - birthFee: paid by the dividing cell to the Colony treasury,
 *   - titheBps: portion of each newborn's endowment that flows back to the
 *     mother (and onward up the lineage at harvest),
 *   - harvestColony/harvestOne: sweeps a percentage of every cell's food to
 *     the owner-configured harvestRecipient, walking the lineage tree.
 */
contract Colony is Ownable {
    uint16 public constant BPS_DENOM = 10000;

    address public immutable nucleusTemplate;
    address public immutable energyTemplate;
    address public immutable chloroplastTemplate;

    uint256 private _nextSerial = 1;
    address[] private _roots;
    mapping(address => bool) public isCell;

    // ---- colony economics (owner-tunable) ----
    uint16 public maxGeneration = 12; // cap lineage depth (v1 had none)
    uint256 public minBirthInterval = 1 hours; // division cooldown (v1 had none)
    uint256 public minReserve = 0; // food the mother must keep after division
    uint256 public birthFee = 0; // fee per division, to treasury
    uint16 public titheBps = 1000; // 10% of endowment returns to mother
    uint16 public harvestBps = 2500; // 25% of each cell's food per harvest
    uint256 public keeperStipend = 0; // flat top-up so triggers profit on L2s
    uint256 public birthGasBudget = 1_250_000; // gas the cell will credit a
        // keeper for when dividing (owner tunes per chain; bounded by caps)
    uint16 public maxRefundBps = 500; // keeper credit <= 5% of cell balance
    uint256 public maxRefundCap = 1 ether; // absolute ceiling per trigger
    address public harvestRecipient;

    // ---- expression-cycle economics (optional-organelle metabolism) ----
    uint256 public cycleMinInterval = 1 hours; // how often workers may run
    uint16 public workerBudgetBps = 2500; // up to 25% of discretionary food may flow to workers per cycle
    uint256 public perWorkerCeiling = 5 ether; // hard per-worker cap per cycle
    uint256 public creditTTL = 30 days; // unclaimed keeper credits past this are digestible
    uint256 public workerGasStipend = 2_000_000; // hard gas ceiling per organ per cycle (audit: DoS; sized to cover a full 64-package Golgi batch with margin)
    uint16 public maxAuxiliaryOrganelles = 24; // registry growth bound (audit: unbounded scans)

    event RootPlanted(address indexed nucleus, uint256 serial, uint256 endowment);
    event Birth(address indexed parent, address indexed child, uint256 serial, uint16 generation, uint256 endowment, uint256 tithe, uint256 fee);
    event Harvested(address indexed fromCell, uint256 amount, address indexed recipient);
    event Grafted(address indexed cell, string name, address instance, uint8 role);
    event CycleParamsSet(uint256 interval, uint16 workerBudgetBps, uint256 perWorkerCeiling, uint256 creditTTL);
    event GovernanceBoundsSet(uint256 workerGasStipend, uint16 maxAuxiliaryOrganelles);
    event DivisionParamsSet();
    event BirthDefect(address indexed child, address organelleClone);
    event Apoptosis(address indexed cell, uint256 swept);

    constructor() Ownable(msg.sender) {
        harvestRecipient = msg.sender;
        // Templates are born with the colony; their COLONY immutable points
        // back here. This is what stops anyone from initializing a rogue
        // clone outside the lineage.
        nucleusTemplate = address(new Nucleus(address(this)));
        energyTemplate = address(new EnergyStore(address(this)));
        chloroplastTemplate = address(new Chloroplast(address(this)));
    }

    receive() external payable {}

    // ---- planting ----

    /// @dev Plant a new root cell. Owner only (the colony's founder).
    function plantRoot(string calldata cellName) external payable onlyOwner returns (address) {
        require(bytes(cellName).length <= 64, "Colony: name too long");
        address childN = Clones.clone(nucleusTemplate);
        address childE = Clones.clone(energyTemplate);
        address childC = Clones.clone(chloroplastTemplate);

        EnergyStore(payable(childE)).initialize(childN);
        Chloroplast(payable(childC)).initialize(childN);

        string[] memory names = new string[](2);
        address[] memory insts = new address[](2);
        address[] memory tmpls = new address[](2);
        uint8[] memory roles = new uint8[](2);
        bool[] memory reps = new bool[](2);
        names[0] = "energy";
        insts[0] = childE;
        tmpls[0] = energyTemplate;
        roles[0] = uint8(INucleus.Role.ENERGY);
        reps[0] = true;
        names[1] = "chloroplast";
        insts[1] = childC;
        tmpls[1] = chloroplastTemplate;
        roles[1] = uint8(INucleus.Role.METABOLISM);
        reps[1] = true;

        uint256 serial = _nextSerial++;
        Nucleus(childN).initialize(cellName, serial, 1, address(0), names, insts, tmpls, roles, reps);
        isCell[childN] = true;
        _roots.push(childN);

        if (msg.value > 0) {
            (bool ok, ) = payable(childE).call{value: msg.value}("");
            require(ok, "Colony: fund failed");
        }
        emit RootPlanted(childN, serial, msg.value);
        return childN;
    }

    // ---- mitosis ----

    /**
     * @dev Assemble a daughter of `parent`. ONLY the parent cell's own
     *      METABOLISM organelle may invoke it, and the endowment + fee are
     *      pulled from the parent's energy store — so a dividing cell spends
     *      only its own capital, never the Colony's.
     */
    function birth(address parent, uint256 endowment) external returns (address child) {
        require(isCell[parent], "Colony: unknown parent cell");
        INucleus p = INucleus(parent);
        require(p.alive(), "Colony: parent is dead");
        require(p.getRole(msg.sender) == INucleus.Role.METABOLISM, "Colony: only a cell's metabolism may divide it");

        uint16 generation = p.generation() + 1;
        require(generation <= maxGeneration, "Colony: max generation");

        // Gather the parent's registry to copy its genome.
        uint256 count = p.organelleCount();
        string[] memory parentNames = p.organelleNames();
        string[] memory names = new string[](count);
        address[] memory insts = new address[](count);
        address[] memory tmpls = new address[](count);
        uint8[] memory roles = new uint8[](count);
        bool[] memory reps = new bool[](count);

        child = Clones.clone(nucleusTemplate);
        address childE = Clones.clone(energyTemplate);
        address childC = Clones.clone(chloroplastTemplate);
        EnergyStore(payable(childE)).initialize(child);
        Chloroplast(payable(childC)).initialize(child);

        uint256 j = 0;
        for (uint256 i = 0; i < count; i++) {
            INucleus.Organelle memory o = p.organelleAt(i);
            if (o.role == INucleus.Role.NUCLEUS) continue; // nucleus self-registers
            names[j] = parentNames[i];
            if (o.role == INucleus.Role.ENERGY) {
                insts[j] = childE;
                tmpls[j] = energyTemplate;
            } else if (o.role == INucleus.Role.METABOLISM) {
                insts[j] = childC;
                tmpls[j] = chloroplastTemplate;
            } else if (o.replicable) {
                // Clone from the TEMPLATE — never from a live instance.
                // This kills v1's inherited proxy-depth gas bloat.
                require(o.template != address(0), "Colony: replicable organelle lacks template");
                insts[j] = Clones.clone(o.template);
                tmpls[j] = o.template;
                // Give the newborn organ its cell: every v2 organelle
                // exposes initialize(address nucleus). Modules that don't
                // (raw proteins) simply skip. If initialization reverts we
                // make noise rather than shipping a dead organ.
                (bool ok, ) = insts[j].call(abi.encodeWithSignature("initialize(address)", child));
                if (!ok) {
                    emit BirthDefect(child, insts[j]);
                }
            } else {
                insts[j] = o.instance; // shared symbiont: pointer copied, not cloned
                tmpls[j] = o.template;
            }
            roles[j] = uint8(o.role);
            reps[j] = o.replicable;
            j++;
        }

        uint256 serial = _nextSerial++;
        Nucleus(child).initialize(string(abi.encodePacked("cell#", Strings.toString(serial))), serial, generation, parent, _slice(names, j), _sliceAddr(insts, j), _sliceAddr(tmpls, j), _sliceU8(roles, j), _sliceBool(reps, j));
        isCell[child] = true;

        // Pay the bill: endowment + fee come out of the parent's food.
        address parentEnergy = p.getOrganelleByRole(INucleus.Role.ENERGY);
        IEnergyStore(parentEnergy).withdraw(payable(childE), endowment);
        if (birthFee > 0) IEnergyStore(parentEnergy).withdraw(payable(address(this)), birthFee);

        // Birth tithe flows back up to the mother.
        uint256 tithe = (endowment * titheBps) / BPS_DENOM;
        if (tithe > 0) IEnergyStore(childE).remitUp(parentEnergy, tithe);

        Nucleus(parent).registerChild(child);
        emit Birth(parent, child, serial, generation, endowment, tithe, birthFee);
    }

    // ---- harvest (the "why bother?" feature v1 never shipped) ----

    /// @dev Sweep `harvestBps` of one cell's food to the harvestRecipient.
    function harvestOne(address cell) external onlyOwner returns (uint256) {
        return _harvestNode(cell);
    }

    /// @dev Walk the lineage tree breadth-first (up to maxNodes cells) and
    ///      sweep a fraction of every cell's food to the harvestRecipient.
    ///      Off-chain rooters are unbounded, so this is the paginated,
    ///      gas-bounded version of "the colony pays its owner".
    function harvestColony(uint256 maxNodes) external onlyOwner returns (uint256 visited, uint256 swept) {
        // Gas-bounded BFS over the lineage forest. If the colony has more
        // cells than maxNodes, the sweep is simply re-run later: each pass
        // takes harvestBps of whatever food is present, so pagination loses
        // nothing except timing.
        require(maxNodes > 0, "Colony: maxNodes zero");
        address[] memory queue = new address[](maxNodes);
        uint256 head = 0;
        uint256 tail = 0;
        uint256 nRoots = _roots.length;
        for (uint256 i = 0; i < nRoots && tail < maxNodes; i++) queue[tail++] = _roots[i];
        while (head < tail && visited < maxNodes) {
            address node = queue[head++];
            visited++;
            swept += _harvestNode(node);
            INucleus n = INucleus(node);
            uint256 kids = n.childrenLength();
            for (uint256 k = 0; k < kids && tail < maxNodes; k++) {
                queue[tail++] = n.children(k);
            }
        }
    }

    function _harvestNode(address cell) private returns (uint256 amount) {
        require(isCell[cell], "Colony: unknown cell");
        if (!INucleus(cell).alive()) return 0;
        address energy = INucleus(cell).getOrganelleByRole(INucleus.Role.ENERGY);
        if (energy == address(0)) return 0;
        // Sweep from the *discretionary* balance only, never from funds the
        // cell already promised to keepers (avoids stranding reimbursements).
        uint256 spendable = IEnergyStore(energy).available();
        amount = (spendable * harvestBps) / BPS_DENOM;
        if (amount > 0) {
            IEnergyStore(energy).remitUp(payable(harvestRecipient), amount);
            emit Harvested(cell, amount, harvestRecipient);
        }
    }

    // ---- maintenance ----

    /// @dev Owner may graft a new organelle onto a cell (symbiosis: third
    ///      party service modules joining an existing lineage member).
    function graft(address cell, string calldata organelleName, address instance, address template, uint8 role, bool replicable) external onlyOwner {
        require(isCell[cell], "Colony: unknown cell");
        Nucleus(cell).graftExternal(organelleName, instance, template, role, replicable);
        emit Grafted(cell, organelleName, instance, role);
    }

    /**
     * @dev Curator bootstrap for the optional organelle cast: clone a
     *      template, bind it to THIS live cell, and graft it in one step.
     *      This is the manual equivalent of what the Ribosome automates
     *      (translate a program -> product -> graft), so an existing cell
     *      can be given new organs it was not born with.
     */
    function graftTemplate(address cell, string calldata organelleName, address template, uint8 role, bool replicable) external onlyOwner returns (address instance) {
        require(isCell[cell], "Colony: unknown cell");
        require(template.code.length > 0, "Colony: template has no code");
        instance = Clones.clone(template);
        // Bind to the cell. The v2 organelles expose initialize(address);
        // a raw module without that entrypoint is still grafted (best-effort)
        // so the curator can install arbitrary proteins.
        (bool ok, ) = instance.call(abi.encodeWithSignature("initialize(address)", cell));
        require(ok, "Colony: graft init failed");
        Nucleus(cell).graftExternal(organelleName, instance, template, role, replicable);
        emit Grafted(cell, organelleName, instance, role);
    }

    /**
     * @dev Curator bridge: forward a call to one of a cell's own organelles,
     *      executed AS the Colony so organelle core-gates (onlyCellCore,
     *      configure, registerService, condemn, schedule, program...) accept
     *      it. The owner already holds full capital authority over the colony
     *      (harvest/apoptosis); this is the configuration counterpart. The
     *      target must be a registered organelle of `cell` - the bridge can
     *      never touch a stranger contract.
     */
    function administer(address cell, address target, bytes calldata data) external onlyOwner returns (bytes memory) {
        require(isCell[cell], "Colony: unknown cell");
        require(INucleus(cell).getRole(target) != INucleus.Role.NONE, "Colony: target not an organelle of this cell");
        return Address.functionCall(target, data);
    }

    /// @dev Programmed cell death: sweep everything to the harvestRecipient
    ///      and mark the nucleus dead. Keeps treasury out of zombie cells.
    function apoptosis(address cell) external onlyOwner {        require(isCell[cell], "Colony: unknown cell");
        address energy = INucleus(cell).getOrganelleByRole(INucleus.Role.ENERGY);
        uint256 bal = energy == address(0) ? 0 : address(energy).balance;
        if (bal > 0) IEnergyStore(energy).withdraw(payable(harvestRecipient), bal);
        Nucleus(cell).setDead();
        emit Apoptosis(cell, bal);
    }

    function setParams(uint16 maxGeneration_, uint256 minBirthInterval_, uint256 minReserve_, uint256 birthFee_, uint16 titheBps_, uint16 harvestBps_, uint256 keeperStipend_, uint16 maxRefundBps_, uint256 maxRefundCap_) external onlyOwner {
        maxGeneration = maxGeneration_;
        minBirthInterval = minBirthInterval_;
        minReserve = minReserve_;
        birthFee = birthFee_;
        titheBps = titheBps_;
        harvestBps = harvestBps_;
        keeperStipend = keeperStipend_;
        maxRefundBps = maxRefundBps_;
        maxRefundCap = maxRefundCap_;
        emit DivisionParamsSet();
    }

    function setHarvestRecipient(address who) external onlyOwner {
        require(who != address(0), "Colony: zero recipient");
        harvestRecipient = who;
    }

    /// @dev Owner tunes the worker expression cycle (v2.1 organelle cast).
    function setCycleParams(uint256 interval, uint16 workerBudgetBps_, uint256 perWorkerCeiling_, uint256 creditTTL_) external onlyOwner {
        require(workerBudgetBps_ <= 10000, "Colony: bps > 100%");
        cycleMinInterval = interval;
        workerBudgetBps = workerBudgetBps_;
        perWorkerCeiling = perWorkerCeiling_;
        creditTTL = creditTTL_;
        emit CycleParamsSet(interval, workerBudgetBps_, perWorkerCeiling_, creditTTL_);
    }

    /// @dev v2.2 audit bounds: per-organ gas stipend + registry size cap.
    function setGovernanceBounds(uint256 workerGasStipend_, uint16 maxAux_) external onlyOwner {
        require(workerGasStipend_ >= 50_000, "Colony: stipend below any organ");
        require(workerGasStipend_ <= 6_000_000, "Colony: stipend is the whole block");
        require(maxAux_ >= 3, "Colony: too few slots for the cast");
        workerGasStipend = workerGasStipend_;
        maxAuxiliaryOrganelles = maxAux_;
        emit GovernanceBoundsSet(workerGasStipend_, maxAux_);
    }

    /// @dev Owner tunes the keeper gas budget per chain (mainnet vs L2 vs
    ///      near-free chains). Always bounded by maxRefundCap/maxRefundBps.
    function setBirthGasBudget(uint256 gas_) external onlyOwner {
        birthGasBudget = gas_;
    }

    /// @dev Withdraw birth-fee revenue accumulated in the treasury.
    function withdrawFees(address payable to, uint256 amount) external onlyOwner {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Colony: fee withdrawal failed");
    }

    function roots(uint256 i) external view returns (address) {
        return _roots[i];
    }

    function rootsLength() external view returns (uint256) {
        return _roots.length;
    }

    // ---- memory array slicing (registry copy is usually smaller than the
    //      declared max because NUCLEUS entries are skipped) ----

    function _slice(string[] memory a, uint256 n) private pure returns (string[] memory) {
        string[] memory o = new string[](n);
        for (uint256 i = 0; i < n; i++) o[i] = a[i];
        return o;
    }

    function _sliceAddr(address[] memory a, uint256 n) private pure returns (address[] memory) {
        address[] memory o = new address[](n);
        for (uint256 i = 0; i < n; i++) o[i] = a[i];
        return o;
    }

    function _sliceU8(uint8[] memory a, uint256 n) private pure returns (uint8[] memory) {
        uint8[] memory o = new uint8[](n);
        for (uint256 i = 0; i < n; i++) o[i] = a[i];
        return o;
    }

    function _sliceBool(bool[] memory a, uint256 n) private pure returns (bool[] memory) {
        bool[] memory o = new bool[](n);
        for (uint256 i = 0; i < n; i++) o[i] = a[i];
        return o;
    }
}
