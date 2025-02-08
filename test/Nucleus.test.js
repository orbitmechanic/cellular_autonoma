const { expect } = require("chai");

describe("Nucleus Contract", function () {
  it("should register and retrieve organelle addresses", async function () {
    const [owner] = await ethers.getSigners();
    const Nucleus = await ethers.getContractFactory("Nucleus");
    const nucleus = await Nucleus.deploy("ProtoNucleus");
    await nucleus.waitForDeployment();

    // Mock organelle address
    const fakeOrganelle = owner.address;

    // Register organelle
    await nucleus.registerOrganelle("Mitochondria", fakeOrganelle);

    // Verify stored address
    expect(await nucleus.getOrganelle("Mitochondria")).to.equal(fakeOrganelle);
  });
});
