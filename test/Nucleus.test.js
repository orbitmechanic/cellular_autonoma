const { expect } = require("chai");

describe("Nucleus Contract", function () {
  it("should initialize with predefined organelles", async function () {
    const [owner] = await ethers.getSigners();
    const Nucleus = await ethers.getContractFactory("Nucleus");

    const organelleNames = ["Mitochondria", "Golgi"];
    const organelleAddresses = [owner.address, owner.address];

    const nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      organelleNames,
      organelleAddresses
    );
    await nucleus.waitForDeployment();

    expect(await nucleus.getOrganelle("Mitochondria")).to.equal(owner.address);
    expect(await nucleus.getOrganelle("Golgi")).to.equal(owner.address);
  });
});
