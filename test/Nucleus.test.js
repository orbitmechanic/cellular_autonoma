const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Nucleus Contract (Cloning & Initialization)", function () {
  let owner, user;
  let Nucleus, nucleus;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    // Get the Nucleus contract factory.
    Nucleus = await ethers.getContractFactory("Nucleus");
    // Deploy the template (which will be used for cloning).
    // Since we're using the initializer pattern, we deploy and then call initialize.
    nucleus = await Nucleus.deploy();
    await nucleus.deployed();
    await nucleus.initialize(
      "Cell1", // identity
      await owner.getAddress(), // Parent's address
      [], // No extra organelles initially
      [],
      []
    );
  });

  it("should initialize with default organelles", async function () {
    // Verify that the default organelles "Parent" and "Nucleus" are set.
    const [names, addresses, flags] = await nucleus.getAllOrganelles();
    const namesArr = Array.from(names);
    expect(namesArr).to.include.members(["Parent", "Nucleus"]);
    const parentName = await nucleus.getOrganelleName(await owner.getAddress());
    expect(parentName).to.equal("Parent");
  });

  it("should allow the Parent to register new organelles and update duplicates", async function () {
    // Parent registers a new organelle "Test" with user’s address.
    await nucleus.registerOrganelle("Test", await user.getAddress(), true);
    const addr = await nucleus.getOrganelleAddress("Test");
    expect(addr).to.equal(await user.getAddress());

    // Now, the Parent re-registers "Test" with a new address (using owner's address) and a different flag.
    await nucleus.registerOrganelle("Test", await owner.getAddress(), false);
    const updatedAddr = await nucleus.getOrganelleAddress("Test");
    expect(updatedAddr).to.equal(await owner.getAddress());
  });

  it("should reject registration from non-Parent accounts", async function () {
    // Attempt to register a new organelle from a non-Parent signer (user).
    await expect(
      nucleus
        .connect(user)
        .registerOrganelle("AnotherTest", await user.getAddress(), true)
    ).to.be.revertedWith("Must be Parent to register new organelle.");
  });

  it("should correctly return organelle details", async function () {
    // Register an organelle "TestOrg" with user’s address.
    await nucleus.registerOrganelle("TestOrg", await user.getAddress(), true);
    expect(await nucleus.getOrganelleName(await user.getAddress())).to.equal(
      "TestOrg"
    );
    expect(await nucleus.getOrganelleAddress("TestOrg")).to.equal(
      await user.getAddress()
    );
    expect(await nucleus.shouldReplicateName("TestOrg")).to.be.true;
  });

  it("should return all organelles", async function () {
    // With no extra registrations, it should at least contain "Parent" and "Nucleus".
    const [names] = await nucleus.getAllOrganelles();
    const namesArr = Array.from(names);
    expect(namesArr).to.include.members(["Parent", "Nucleus"]);
  });

  describe("Cloning", function () {
    it("should clone itself and initialize the clone properly", async function () {
      // Call cloneCell() which clones this Nucleus and initializes the clone.
      const cloneTx = await nucleus.cloneCell();
      // The cloneCell function returns the address of the new clone.
      const cloneAddress = await cloneTx; // Assuming cloneCell() returns an address directly.
      // Attach the factory to the clone address.
      const clonedNucleus = Nucleus.attach(cloneAddress);
      // The clone should have been initialized with identity "Cell1 copy".
      expect(await clonedNucleus.identity()).to.equal("Cell1 copy");
      // The clone should have default organelles; for instance, "Parent" and "Nucleus" should be present.
      const [cloneNames] = await clonedNucleus.getAllOrganelles();
      const cloneNamesArr = Array.from(cloneNames);
      expect(cloneNamesArr).to.include.members(["Parent", "Nucleus"]);
    });
  });
});
