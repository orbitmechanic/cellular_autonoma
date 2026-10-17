const { expect } = require("chai");
const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// v2 economics: keeper reimbursement (self-funded metabolism), birth fees,
// tithes up the lineage, and colony-wide harvest to the root owner.
// ---------------------------------------------------------------------------

async function deployColony() {
  const Colony = await ethers.getContractFactory("contracts/v2/Colony.sol:Colony");
  return Colony.deploy();
}

async function attachCell(nucleusAddr) {
  const Nucleus = await ethers.getContractFactory("contracts/v2/Nucleus.sol:Nucleus");
  const EnergyStore = await ethers.getContractFactory("contracts/v2/EnergyStore.sol:EnergyStore");
  const Chloroplast = await ethers.getContractFactory("contracts/v2/Chloroplast.sol:Chloroplast");
  const nucleus = Nucleus.attach(nucleusAddr);
  const energyAddr = await nucleus.getOrganelleByRole(2n);
  const chloroAddr = await nucleus.getOrganelleByRole(3n);
  return { nucleus, energy: EnergyStore.attach(energyAddr), chloroplast: Chloroplast.attach(chloroAddr), energyAddr, chloroAddr };
}

async function plantRoot(colony, value) {
  const tx = await colony.plantRoot("root-1", { value });
  const receipt = await tx.wait();
  const ev = receipt.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "RootPlanted");
  return ev.args.nucleus;
}

async function birthEvents(colony, tx) {
  const receipt = await tx.wait();
  const ev = receipt.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "Birth");
  return { receipt, child: ev.args.child };
}

describe("v2 keeper economics (the cell pays its own gas)", function () {
  let owner, keeper, colony, rootAddr, root;

  beforeEach(async function () {
    [owner, keeper] = await ethers.getSigners();
    colony = await deployColony();
    await colony.setParams(12, 0, 0, 0, 1000, 2500, 0, 500, ethers.parseEther("1"));
    rootAddr = await plantRoot(colony, ethers.parseEther("10"));
    root = await attachCell(rootAddr);
  });

  it("credits the trigger for essentially its full on-chain gas cost", async function () {
    const tx = await root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"));
    const receipt = await tx.wait();
    const actualCost = receipt.gasUsed * receipt.gasPrice;
    const credit = await root.energy.claimable(keeper.address);
    // The cell can't read the receipt on-chain, so it pays a budgeted figure.
    // Safety properties: (a) the keeper is covered for at least 90% of what
    // the chain charged (triggering is never a loss worth avoiding), and (b)
    // over-credit is bounded well under a full refund cap.
    expect(credit).to.be.gte((actualCost * 90n) / 100n, "keeper under-covered");
    expect(credit).to.be.lte((actualCost * 120n) / 100n, "keeper over-covered");
  });

  it("keeper is made whole by claiming (pull payment)", async function () {
    const tx = await root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"));
    const receipt = await tx.wait();
    const spent = receipt.gasUsed * receipt.gasPrice;

    const credit = await root.energy.claimable(keeper.address);
    const claimTx = await root.energy.connect(keeper).claim(keeper.address, credit);
    const claimReceipt = await claimTx.wait();
    const claimCost = claimReceipt.gasUsed * claimReceipt.gasPrice;

    // The keeper's credit must at least return the gas they spent on the
    // birth itself (the claim is a separate small cost they can defer).
    expect(credit).to.be.gte(spent, "replicate should not cost the keeper net");
  });

  it("respects the absolute refund cap", async function () {
    await colony.setParams(12, 0, 0, 0, 0, 2500, 0, 5000, 50000); // cap 50k wei
    const tx = await root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"));
    await tx.wait();
    expect(await root.energy.claimable(keeper.address)).to.equal(50000n);
  });

  it("respects the share-of-balance cap so keepers can never strip a cell", async function () {
    await colony.setParams(12, 0, 0, 0, 0, 2500, 0, 1, ethers.parseEther("1")); // max 0.01% of balance
    const tx = await root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"));
    await tx.wait();
    const remaining = await root.energy.getBalance();
    const credit = await root.energy.claimable(keeper.address);
    expect(credit).to.be.lte(remaining / 10000n);
  });

  it("only self-claims", async function () {
    const tx = await root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"));
    await tx.wait();
    const thief = (await ethers.getSigners())[3]; // keeper is signers[1]; pick a different EOA
    const credit = await root.energy.claimable(keeper.address);
    expect(credit).to.be.gt(0);
    await expect(
      root.energy.connect(thief).claim(keeper.address, credit)
    ).to.be.revertedWith("EnergyStore: claim is self-service only");
  });

  it("a flat stipend makes triggering profitable even at negligible gas prices", async function () {
    await colony.setParams(12, 0, 0, 0, 0, 2500, ethers.parseEther("0.01"), 500, ethers.parseEther("1"));
    const tx = await root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"));
    await tx.wait();
    // credit = gas refund + stipend, so it must exceed the stipend alone.
    expect(await root.energy.claimable(keeper.address)).to.be.gte(ethers.parseEther("0.01"));
  });
});

describe("v2 colony harvest (capital flows to the root deployer)", function () {
  let owner, colony, rootAddr, root;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    colony = await deployColony();
    await colony.setParams(12, 0, 0, 0, 1000, 2500, 0, 500, ethers.parseEther("1"));
    rootAddr = await plantRoot(colony, ethers.parseEther("10"));
    root = await attachCell(rootAddr);
  });

  it("birth tithe flows from daughter back to mother", async function () {
    const [, , , , , , , , , extra] = await ethers.getSigners();
    const before = await root.energy.getBalance();
    const tx = await root.chloroplast.connect(extra).replicate(ethers.parseEther("2"));
    await tx.wait();
    const after = await root.energy.getBalance();
    // 10 - 2 endowment + 0.2 tithe (10%) = 8.2
    expect(after - before).to.equal(ethers.parseEther("-1.8"));
  });

  it("harvestOne sweeps a percentage of one cell", async function () {
    const [, , wallet] = await ethers.getSigners();
    await colony.setHarvestRecipient(wallet.address);
    const balBefore = await root.energy.getBalance();
    await expect(() => colony.harvestOne(rootAddr)).to.changeEtherBalance(wallet, balBefore / 4n);
    expect(await root.energy.getBalance()).to.equal(balBefore - balBefore / 4n);
  });

  it("harvestColony walks the whole lineage tree and pays the recipient", async function () {
    // Grow: 3 children of root, 1 grandchild under the first child.
    const [, k1, k2, k3, k4] = await ethers.getSigners();
    const children = [];
    for (const k of [k1, k2, k3]) {
      const { child } = await birthEvents(colony, await root.chloroplast.connect(k).replicate(ethers.parseEther("0.5")));
      children.push(child);
    }
    const first = await attachCell(children[0]);
    const { child: grandchild } = await birthEvents(colony, await first.chloroplast.connect(k4).replicate(ethers.parseEther("0.2")));

    // Feed every cell from the outside (simulating AI-agent / service income).
    const cells = [...children, grandchild];
    for (const cell of cells) {
      const c = await attachCell(cell);
      await owner.sendTransaction({ to: c.energyAddr, value: ethers.parseEther("1") });
    }

    const [, , thirdParty] = await ethers.getSigners();
    await colony.setHarvestRecipient(thirdParty.address);
    const recipientBefore = await ethers.provider.getBalance(thirdParty.address);

    const tx = await colony.harvestColony(100);
    const receipt = await tx.wait();
    const harvestLogs = receipt.logs
      .map((l) => colony.interface.parseLog(l))
      .filter((p) => p && p.name === "Harvested");
    // root + 3 children + 1 grandchild = 5 cells swept.
    expect(harvestLogs.length).to.equal(5);
    const swept = harvestLogs.reduce((s, l) => s + l.args.amount, 0n);
    expect(swept).to.be.gt(ethers.parseEther("1.5"));
    // Everything landed at the root owner's harvest recipient.
    expect(await ethers.provider.getBalance(thirdParty.address)).to.equal(recipientBefore + swept);
  });

  it("birth fee revenue accumulates in the treasury and is withdrawable", async function () {
    await colony.setParams(12, 0, 0, ethers.parseEther("0.1"), 0, 2500, 0, 500, ethers.parseEther("1"));
    const [, k] = await ethers.getSigners();
    await (await root.chloroplast.connect(k).replicate(ethers.parseEther("1"))).wait();
    expect(await ethers.provider.getBalance(await colony.getAddress())).to.equal(ethers.parseEther("0.1"));
    const [, , wallet] = await ethers.getSigners();
    await expect(() =>
      colony.withdrawFees(wallet.address, ethers.parseEther("0.1"))
    ).to.changeEtherBalance(wallet, ethers.parseEther("0.1"));
  });

  it("economics model: a fed cell divides repeatedly and pays all its bills", async function () {
    // Feed the root 20 ether of "service income", let it divide 5 times,
    // each keeper fully reimbursed, then birth once more with receipts.
    await owner.sendTransaction({ to: root.energyAddr, value: ethers.parseEther("20") });
    const signers = await ethers.getSigners();
    for (let i = 0; i < 5; i++) {
      const keeper = signers[1 + (i % 6)];
      const tx = await root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"));
      const receipt = await tx.wait();
      const cost = receipt.gasUsed * receipt.gasPrice;
      const credit = await root.energy.claimable(keeper.address);
      expect(credit).to.be.gte((cost * 90n) / 100n);
      const claimTx = await root.energy.connect(keeper).claim(keeper.address, credit);
      await claimTx.wait();
    }
    // After 5 divisions: each daughter holds 0.9 ether (1 - 10% tithe);
    // root kept the rest and still has food for another round.
    const { child } = await birthEvents(colony, await root.chloroplast.connect(signers[1]).replicate(ethers.parseEther("1")));
    expect(child).to.not.equal(ethers.ZeroAddress);
    const c = await attachCell(child);
    expect(await c.energy.getBalance()).to.equal(ethers.parseEther("0.9"));
  });
});
