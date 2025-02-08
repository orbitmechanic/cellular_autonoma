const { expect } = require("chai");

describe("Cell Contract", function () {
  it("should initialize with the correct identity", async function () {
    const Cell = await ethers.getContractFactory("Cell");
    const cell = await Cell.deploy("ProtoCell");
    await cell.waitForDeployment();

    expect(await cell.getIdentity()).to.equal("ProtoCell");
  });
});
