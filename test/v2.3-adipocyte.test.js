const { expect } = require("chai");
const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// v2.3 Adipocyte (the fat cell): rent-funded blubber, EIP-3529-correct
// rendering, and a MEASURED gas discount for keepers on high-gas txs.
// ---------------------------------------------------------------------------

const ROLE = { ENERGY: 2n, METABOLISM: 3n, OTHER: 5n, WORKER: 6n };

async function setup() {
  const [owner, keeper, tenant] = await ethers.getSigners();
  const Colony = await ethers.getContractFactory("contracts/v2/Colony.sol:Colony");
  const colony = await Colony.deploy();
  await colony.setParams(12, 0, 0, 0, 0, 2500, 0, 500, ethers.parseEther("1"));
  await colony.setCycleParams(0, 2500, ethers.parseEther("10"), 30 * 86400); // generous TTL so no digest interference
  const tx = await colony.plantRoot("root-1", { value: ethers.parseEther("100") });
  const r = await tx.wait();
  const rootAddr = r.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "RootPlanted").args.nucleus;
  const Nucleus = await ethers.getContractFactory("contracts/v2/Nucleus.sol:Nucleus");
  const Chloro = await ethers.getContractFactory("contracts/v2/Chloroplast.sol:Chloroplast");
  const EnergyStore = await ethers.getContractFactory("contracts/v2/EnergyStore.sol:EnergyStore");
  const nucleus = Nucleus.attach(rootAddr);
  const chloro = Chloro.attach(await nucleus.getOrganelleByRole(ROLE.METABOLISM));
  const energy = EnergyStore.attach(await nucleus.getOrganelleByRole(ROLE.ENERGY));

  const Adi = await ethers.getContractFactory("contracts/v2/organelles/Adipocyte.sol:Adipocyte");
  const tmpl = await Adi.deploy(await colony.getAddress());
  const g = await (await colony.graftTemplate(rootAddr, "adipocyte", tmpl.target, ROLE.WORKER, true)).wait();
  const adAddr = g.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "Grafted").args.instance;
  const adi = Adi.attach(adAddr);
  return { owner, keeper, tenant, colony, rootAddr, nucleus, chloro, energy, adi, Adi };
}

async function setBasefee(wei) {
  await ethers.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x" + wei.toString(16)]);
}

async function parseEvi(contract, receipt, name) {
  return receipt.logs.map((l) => contract.interface.parseLog(l)).filter((p) => p && p.name === name);
}

describe("v2.3 Adipocyte (fat cell)", function () {
  it("is inert until configured, and refuses a buy-high/sell-low policy", async function () {
    const { colony, rootAddr, adi, chloro, keeper } = await setup();
    // unconfigured: a cycle activates it but blubber stays empty
    await (await chloro.connect(keeper).express()).wait();
    expect(await adi.filled()).to.equal(0);
    const data = adi.interface.encodeFunctionData("configure", [1, 64, 10, 5, 32]); // floor(5) <= ceiling(10)
    await expect(colony.administer(rootAddr, adi.target, data)).to.be.revertedWith(
      "Adipocyte: floor must exceed ceiling"
    );
  });

  it("park() collects rent as food, fattens blubber, and bounds capacity", async function () {
    const { adi, energy, tenant, colony, rootAddr } = await setup();
    // configure: rent 1 gwei * 22100 gas * 2 margin ~ 44200 gwei? use 0.001 ether rent, 4 slots, cheap inflation
    await (await colony.administer(rootAddr, adi.target,
      adi.interface.encodeFunctionData("configure", [ethers.parseEther("0.001"), 4, 1000000000n, 10000000000n, 64])
    )).wait();

    await expect(() =>
      adi.connect(tenant).park(ethers.id("commitment"), { value: ethers.parseEther("0.001") })
    ).to.changeEtherBalance(energy, ethers.parseEther("0.001"));
    expect(await adi.filled()).to.equal(1);
    expect(await adi.rentEarned()).to.equal(ethers.parseEther("0.001"));

    await expect(adi.connect(tenant).park(ethers.ZeroHash, { value: ethers.parseEther("1") }))
      .to.be.revertedWith("Adipocyte: zero data cannot be fattened");
    await expect(adi.connect(tenant).park(ethers.id("x"), { value: 1n }))
      .to.be.revertedWith("Adipocyte: rent too low");
    for (let i = 0; i < 3; i++) await adi.connect(tenant).park(ethers.id(`k${i}`), { value: ethers.parseEther("0.001") });
    await expect(adi.connect(tenant).park(ethers.id("overflow"), { value: ethers.parseEther("1") }))
      .to.be.revertedWith("Adipocyte: body capacity");
  });

  it("expression cycle fattens at cheap gas, idles in the middle band", async function () {
    const { colony, rootAddr, adi, chloro, energy, keeper } = await setup();
    await (await colony.administer(rootAddr, adi.target,
      adi.interface.encodeFunctionData("configure", [1, 40, 500000000n /* <=0.5 gwei inflate */, 10000000000n /* 10 gwei render */, 64])
    )).wait();

    await setBasefee(200000000); // 0.2 gwei: cheap season
    const budget = await energy.available(); // act budget = 25% pool capped 10 eth
    await (await chloro.connect(keeper).express()).wait();
    const filled = await adi.filled();
    expect(filled).to.be.gte(1);
    expect(filled).to.be.lte(40);
    // ETH cost to the cell = keeper credit only (budget guard: 10 ETH / (22100*0.2gwei) = 2268 slots, so 40-slot cap binds)
    expect(filled).to.equal(40);

    await setBasefee(2000000000); // 2 gwei: dead band - no fatten, no render
    await (await chloro.connect(keeper).express()).wait();
    expect(await adi.filled()).to.equal(40);
    void budget;
  });

  it("RENDER MEASUREMENT: bundling fat into a replicate discounts its gas bill under EIP-3529", async function () {
    const { colony, rootAddr, adi, chloro, keeper } = await setup();
    await (await colony.administer(rootAddr, adi.target,
      adi.interface.encodeFunctionData("configure", [1, 64, 500000000n, 1000000000n /* 1 gwei floor */, 64])
    )).wait();

    // fatten the full cycle allotment (64 slots) at 0.2 gwei
    await setBasefee(200000000);
    await (await chloro.connect(keeper).express()).wait();
    expect(await adi.filled()).to.equal(64);

    // Render all 64 at high gas and measure the EIP-3529 signature:
    // execution = 21000 base + 64 x (2100 cold read + 2900 reset + ~2k bookkeeping)
    //           = 469,000 gas. Refund = min(64 x 4800, pre/5) => billed in [0.8x, 1.0x].
    await setBasefee(10000000000); // 10 gwei season
    const renderTx = await (await adi.connect(keeper).render(64)).wait();
    const executedFloor = 469000n;
    expect(renderTx.gasUsed).to.be.lt(executedFloor); // discount WAS applied
    expect(renderTx.gasUsed).to.be.gte((executedFloor * 4n) / 5n - 20000n); // but never more than the 1/5 cap
    expect(await adi.filled()).to.equal(0);
    expect(await adi.renderedTotal()).to.equal(64);

    // render refuses when gas is cheap (option not exercised at a loss)
    await setBasefee(200000000);
    await expect(adi.connect(keeper).render(10)).to.be.revertedWith(
      "Adipocyte: gas too cheap to burn fat"
    );
  });

  it("keeper credit is unaffected by blubber work, and refunds belong to the trigger", async function () {
    const { colony, rootAddr, adi, chloro, energy, keeper } = await setup();
    await (await colony.administer(rootAddr, adi.target,
      adi.interface.encodeFunctionData("configure", [1, 24, 500000000n, 5000000000n, 24])
    )).wait();
    await setBasefee(200000000); // cheap: the cycle will fatten
    const creditBefore = await energy.claimable(keeper.address);
    await (await chloro.connect(keeper).express()).wait();
    const creditAfter = await energy.claimable(keeper.address);
    // the express credit grew by THIS cycle's work (bounded, sane):
    const delta = creditAfter - creditBefore;
    expect(delta).to.be.gt(0);
    expect(delta).to.be.lt(ethers.parseEther("0.05")); // gas-priced at 0.2 gwei, nowhere near treasury scale
    // blubber exists and the ETH cost to the cell was only that credit
    expect(await adi.filled()).to.equal(24);
  });

  it("an un-rendered organ cycle still works when blubber capacity is full", async function () {
    const ctx = await setup();
    const { colony, rootAddr, adi, chloro, keeper } = ctx;
    await (await colony.administer(rootAddr, adi.target,
      adi.interface.encodeFunctionData("configure", [1, 8, 500000000n, 5000000000n, 8])
    )).wait();
    await setBasefee(100000000);
    await (await chloro.connect(keeper).express()).wait();
    expect(await adi.filled()).to.equal(8);
    // one more cycle at cheap gas: capacity full, must not revert the cell
    const r = await (await chloro.connect(keeper).express()).wait();
    expect(r.status).to.equal(1);
    expect((await parseEvi(chloro, r, "OrganFailed")).length).to.equal(0);
  });
});
