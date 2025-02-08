const { expect } = require("chai");

describe("Nucleus Contract", function () {
  it("should track which organelles need replication", async function () {
    const [owner] = await ethers.getSigners();
    const Nucleus = await ethers.getContractFactory("Nucleus");

    const organelleNames = ["Mitochondria", "Golgi"];
    const organelleAddresses = [owner.address, owner.address];
    const replicationFlags = [true, false]; // Mitochondria replicates, Golgi does not

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
  });
});
