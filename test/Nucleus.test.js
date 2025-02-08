const { expect } = require("chai");

describe("Nucleus Contract", function () {
  it("should return all registered organelles", async function () {
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

    const [names, addresses] = await nucleus.getAllOrganelles();

    expect(names).to.deep.equal(organelleNames);
    expect(addresses).to.deep.equal(organelleAddresses);
  });
});
