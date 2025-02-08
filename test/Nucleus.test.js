const { expect } = require("chai");

describe("Nucleus Contract", function () {
  it("should track which organelles need replication", async function () {
    const [owner] = await ethers.getSigners();
    const Nucleus = await ethers.getContractFactory("Nucleus");

    const organelleNames = ["Mitochondria", "Golgi"];
    const organelleAddresses = [owner.address, owner.address];
    const replicationFlags = [true, false];

    const nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      organelleNames,
      organelleAddresses,
      replicationFlags
    );
    await nucleus.waitForDeployment();

    const [names, addresses, flags] = await nucleus.getAllOrganelles();

    expect(names).to.deep.equal(organelleNames);
    expect(addresses).to.deep.equal(organelleAddresses);
    expect(flags).to.deep.equal(replicationFlags);

    // Test existing organelles
    expect(await nucleus.getOrganelleAddress("Parent")).to.equal(owner.address);
    expect(await nucleus.getOrganelleName(owner.address)).to.equal("Parent");
    expect(await nucleus.shouldReplicateName("Nucleus")).to.be.true;
  });

  it("should allow registration of new organelles", async function () {
    const [owner, anotherAccount] = await ethers.getSigners();
    const Nucleus = await ethers.getContractFactory("Nucleus");
    const nucleus = await Nucleus.deploy("ProtoNucleus", [], [], []);
    await nucleus.waitForDeployment();

    // Attempt to register a new organelle as Parent
    await nucleus.registerOrganelle("Test1", anotherAccount.address, true);

    const [names, addresses, flags] = await nucleus.getAllOrganelles();
    expect(names).to.include("Test1");
  });

  it("should handle duplicate organelle registration", async function () {
    const [owner] = await ethers.getSigners();
    const Nucleus = await ethers.getContractFactory("Nucleus");
    const nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      ["Test"],
      [owner.address],
      [true]
    );
    await nucleus.waitForDeployment();

    // Try adding duplicate
    await nucleus.registerOrganelle("Test", owner.address, true);

    const [names] = await nucleus.getAllOrganelles();
    expect(names).to.have.length(1);
  });

  it("should reject registration from non-Parent accounts", async function () {
    const [owner, anotherAccount] = await ethers.getSigners();
    const Nucleus = await ethers.getContractFactory("Nucleus");
    const nucleus = await Nucleus.deploy("ProtoNucleus", [], [], []);
    await nucleus.waitForDeployment();

    // Try registering as non-Parent
    expect(
      nucleus
        .connect(anotherAccount)
        .registerOrganelle("Test", anotherAccount.address, true)
    ).to.be.revertedWith("Only Parent can register");
  });

  it("should handle empty organelles deployment", async function () {
    const [owner] = await ethers.getSigners();
    const Nucleus = await ethers.getContractFactory("Nucleus");
    const nucleus = await Nucleus.deploy("ProtoNucleus", [], [], []);
    await nucleus.waitForDeployment();

    const [names, addresses, flags] = await nucleus.getAllOrganelles();
    expect(names).to.be.empty;
  });

  it("should handle invalid organelle registration", async function () {
    const [owner] = await ethers.getSigners();
    const Nucleus = await ethers.getContractFactory("Nucleus");
    const nucleus = await Nucleus.deploy("ProtoNucleus", [], [], []);
    await nucleus.waitForDeployment();

    // Try registering with zero address
    expect(
      nucleus.registerOrganelle("Test", ethers.constants.AddressZero, true)
    ).to.be.revertedWith("Invalid address");
  });
});
