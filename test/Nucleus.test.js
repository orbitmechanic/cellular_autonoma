const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Nucleus Contract", function () {
  let owner, anotherAccount, Nucleus, nucleus;

  beforeEach(async function () {
    [owner, anotherAccount] = await ethers.getSigners();
    Nucleus = await ethers.getContractFactory("Nucleus");
  });

  it("should track which organelles need replication", async function () {
    const organelleNames = ["Mitochondria", "Golgi"];
    const organelleAddresses = [
      await owner.getAddress(),
      await owner.getAddress(),
    ];
    const replicationFlags = [true, false];

    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      organelleNames,
      organelleAddresses,
      replicationFlags
    );
    await nucleus.waitForDeployment();

    const [names, addresses, flags] = await nucleus.getAllOrganelles();

    // Ensure correct order
    expect(names.length).to.equal(4);
    expect(names[0]).to.equal("Parent");
    expect(names[1]).to.equal("Nucleus");
    expect(names[2]).to.equal("Mitochondria");
    expect(names[3]).to.equal("Golgi");

    expect(addresses[2]).to.equal(await owner.getAddress());
    expect(addresses[3]).to.equal(await owner.getAddress());

    expect(flags[2]).to.be.true;
    expect(flags[3]).to.be.false;

    // Test existing organelles
    expect(await nucleus.getOrganelleAddress("Parent")).to.equal(
      await owner.getAddress()
    );
    expect(await nucleus.getOrganelleName(await owner.getAddress())).to.equal(
      "Parent"
    );
    expect(await nucleus.shouldReplicateName("Nucleus")).to.be.true;
  });

  it("should allow registration of new organelles", async function () {
    nucleus = await Nucleus.deploy("ProtoNucleus", [], [], []);
    await nucleus.waitForDeployment();

    // Register new organelle as Parent
    await nucleus.registerOrganelle(
      "Test1",
      await anotherAccount.getAddress(),
      true
    );

    const [names, addresses, flags] = await nucleus.getAllOrganelles();
    expect(names).to.include("Test1");
    expect(addresses).to.include(await anotherAccount.getAddress());
    expect(flags[names.indexOf("Test1")]).to.be.true;
  });

  it("should reject duplicate organelle registration", async function () {
    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      ["Test"],
      [await owner.getAddress()],
      [true]
    );
    await nucleus.waitForDeployment();

    // Try adding duplicate
    await expect(
      nucleus.registerOrganelle("Test", await owner.getAddress(), true)
    ).to.be.revertedWith("Organelle name already registered");

    const [names] = await nucleus.getAllOrganelles();
    expect(names.filter((name) => name === "Test")).to.have.length(1);
  });

  it("should reject registration from non-Parent accounts", async function () {
    nucleus = await Nucleus.deploy("ProtoNucleus", [], [], []);
    await nucleus.waitForDeployment();

    // Try registering as non-Parent
    await expect(
      nucleus
        .connect(anotherAccount)
        .registerOrganelle("Test", await anotherAccount.getAddress(), true)
    ).to.be.revertedWith("Only Parent can register");
  });

  it("should correctly initialize with only Parent and Nucleus when empty", async function () {
    nucleus = await Nucleus.deploy("ProtoNucleus", [], [], []);
    await nucleus.waitForDeployment();

    const [names, addresses, flags] = await nucleus.getAllOrganelles();
    expect(names).to.deep.equal(["Parent", "Nucleus"]);
    expect(await nucleus.getOrganelleAddress("Parent")).to.equal(
      await owner.getAddress()
    );
    expect(await nucleus.getOrganelleAddress("Nucleus")).to.equal(
      nucleus.target
    );
  });

  it("should reject invalid organelle registration", async function () {
    nucleus = await Nucleus.deploy("ProtoNucleus", [], [], []);
    await nucleus.waitForDeployment();

    // Try registering with zero address
    await expect(
      nucleus.registerOrganelle("Test", ethers.ZeroAddress, true)
    ).to.be.revertedWith("Invalid address");
  });

  it("should return correct organelle name for an address", async function () {
    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      ["TestOrg"],
      [await anotherAccount.getAddress()],
      [true]
    );
    await nucleus.waitForDeployment();

    expect(
      await nucleus.getOrganelleName(await anotherAccount.getAddress())
    ).to.equal("TestOrg");
  });

  it("should return correct organelle address for a name", async function () {
    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      ["TestOrg"],
      [await anotherAccount.getAddress()],
      [true]
    );
    await nucleus.waitForDeployment();

    expect(await nucleus.getOrganelleAddress("TestOrg")).to.equal(
      await anotherAccount.getAddress()
    );
  });

  it("should correctly report replication flags", async function () {
    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      ["TestOrg1", "TestOrg2"],
      [await owner.getAddress(), await anotherAccount.getAddress()],
      [true, false]
    );
    await nucleus.waitForDeployment();

    expect(await nucleus.shouldReplicateName("TestOrg1")).to.be.true;
    expect(await nucleus.shouldReplicateName("TestOrg2")).to.be.false;
  });

  it("should handle registering multiple organelles correctly", async function () {
    nucleus = await Nucleus.deploy("ProtoNucleus", [], [], []);
    await nucleus.waitForDeployment();

    await nucleus.registerOrganelle(
      "Organelle1",
      await owner.getAddress(),
      true
    );
    await nucleus.registerOrganelle(
      "Organelle2",
      await anotherAccount.getAddress(),
      false
    );

    const [names, addresses, flags] = await nucleus.getAllOrganelles();
    expect(names).to.include("Organelle1");
    expect(names).to.include("Organelle2");
    expect(flags[names.indexOf("Organelle1")]).to.be.true;
    expect(flags[names.indexOf("Organelle2")]).to.be.false;
  });
});
