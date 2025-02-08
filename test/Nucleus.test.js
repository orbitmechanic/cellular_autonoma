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
    // Use anotherAccount for additional organelles so that the Parent mapping remains intact.
    const organelleAddresses = [
      await anotherAccount.getAddress(),
      await anotherAccount.getAddress(),
    ];
    const replicationFlags = [true, false];

    // Deploy with owner's address explicitly as the Parent.
    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      await owner.getAddress(),
      organelleNames,
      organelleAddresses,
      replicationFlags
    );
    await nucleus.waitForDeployment();

    let [names, addresses, flags] = await nucleus.getAllOrganelles();

    // Convert returned arrays to JS arrays.
    names = Array.from(names);
    addresses = Array.from(addresses);
    flags = Array.from(flags);

    // Verify that all expected organelle names are present (order is not enforced)
    expect(names).to.include.members([
      "Parent",
      "Nucleus",
      "Mitochondria",
      "Golgi",
    ]);

    // Confirm that querying by the parent's address returns "Parent"
    expect(await nucleus.getOrganelleName(await owner.getAddress())).to.equal(
      "Parent"
    );
  });

  it("should update registration when duplicate organelle registration is attempted by Parent", async function () {
    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      await owner.getAddress(),
      ["Test"],
      [await anotherAccount.getAddress()],
      [true]
    );
    await nucleus.waitForDeployment();

    // Parent re-registers "Test" with a new address (e.g. owner's address) and a different flag.
    await nucleus.registerOrganelle("Test", await owner.getAddress(), false);
    // Now, retrieving the organelle address for "Test" should return owner's address.
    const addr = await nucleus.getOrganelleAddress("Test");
    expect(addr).to.equal(await owner.getAddress());
  });

  it("should reject registration from non-Parent accounts", async function () {
    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      await owner.getAddress(),
      [],
      [],
      []
    );
    await nucleus.waitForDeployment();

    // Use anotherAccount as the non-Parent.
    await expect(
      nucleus
        .connect(anotherAccount)
        .registerOrganelle("Test", await anotherAccount.getAddress(), true)
    ).to.be.revertedWith("Must be Parent to register new organelle.");
  });

  it("should correctly initialize with only Parent and Nucleus when empty", async function () {
    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      await owner.getAddress(),
      [],
      [],
      []
    );
    await nucleus.waitForDeployment();

    const [names] = await nucleus.getAllOrganelles();
    expect(Array.from(names)).to.include.members(["Parent", "Nucleus"]);
  });

  it("should reject invalid organelle registration", async function () {
    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      await owner.getAddress(),
      [],
      [],
      []
    );
    await nucleus.waitForDeployment();

    // Using ethers.ZeroAddress (Ethers v6) to represent the zero address.
    await expect(
      nucleus.registerOrganelle("Test", ethers.ZeroAddress, true)
    ).to.be.revertedWith("Invalid address");
  });

  it("should return correct organelle name for an address", async function () {
    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      await owner.getAddress(),
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
      await owner.getAddress(),
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
      await owner.getAddress(),
      ["TestOrg1", "TestOrg2"],
      [await anotherAccount.getAddress(), await owner.getAddress()],
      [true, false]
    );
    await nucleus.waitForDeployment();

    expect(await nucleus.shouldReplicateName("TestOrg1")).to.be.true;
    expect(await nucleus.shouldReplicateName("TestOrg2")).to.be.false;
  });

  it("should handle registering multiple organelles correctly", async function () {
    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      await owner.getAddress(),
      [],
      [],
      []
    );
    await nucleus.waitForDeployment();

    await nucleus.registerOrganelle(
      "Organelle1",
      await anotherAccount.getAddress(),
      true
    );
    await nucleus.registerOrganelle(
      "Organelle2",
      await owner.getAddress(),
      false
    );

    const [names] = await nucleus.getAllOrganelles();
    expect(Array.from(names)).to.include.members(["Organelle1", "Organelle2"]);
  });
});
