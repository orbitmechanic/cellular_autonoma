const { ethers } = require("ethers");
const { expect } = require("chai");

describe("Leucoplast", function () {
  let leucoplast;
  let nucleusAddress;
  let cellMember1;
  let cellMember2;
  let attacker;

  // Mock implementation of INucleus interface for testing
  const mockNucleus = {
    getOrganelleName: (address) => {
      if (address === cellMember1 || address === cellMember2) {
        return "CellMember";
      }
      return "";
    },
  };

  before(async function () {
    // Setup test environment
    const provider = new ethers.providers.JsonRpcProvider();
    const wallet = await provider.getSigner();

    nucleusAddress = wallet.address;
    cellMember1 = "0x12345678901234567890123456789012345";
    cellMember2 = "0xabcdefabcdefabcdefabcdefabcd";
    attacker = "0xdeadbeefdeadbeefdeadbeefdeadbeef";

    // Deploy Leucoplast contract
    const factory = new ethers.ContractFactory(
      [
        /* Leucoplast.sol bytecode */
        // Replace with actual bytecode
      ],
      provider
    );
    leucoplast = await factory.deploy(nucleusAddress);
  });

  describe("Initialization", () => {
    it("should set the nucleus address correctly", async () => {
      expect(await leucoplast.nucleus()).to.equal(nucleusAddress);
    });
  });

  describe("Withdraw Functionality", () => {
    beforeEach(async () => {
      // Fund the Leucoplast contract
      await leucoplast.send({ value: ethers.utils.parseEther("10") });
    });

    it("should allow a cell member to withdraw up to max limit", async () => {
      const recipient = cellMember1;
      const amount = ethers.utils.parseEther("4"); // Half of 8 (since 10 /2 is 5, but using 4 for safety)

      await leucoplast.connect(cellMember1).withdraw(recipient, amount);
      expect(await leucoplast.getBalance()).to.be.lt(
        ethers.utils.parseEther("6")
      );
    });

    it("should revert when attempting to withdraw more than max limit", async () => {
      const recipient = cellMember1;
      const amount = ethers.utils.parseEther("6"); // Exceeds 5 (half of 10)

      await expect(
        leucoplast.connect(cellMember1).withdraw(recipient, amount)
      ).to.be.revertedWith("Exceeds max withdrawal limit");
    });

    it("should revert when attempted by a non-cell member", async () => {
      const recipient = attacker;
      const amount = ethers.utils.parseEther("1");

      await expect(
        leucoplast.connect(attacker).withdraw(recipient, amount)
      ).to.be.revertedWith("Cannot withdraw by external Tx.");
    });
  });

  describe("Receive Functionality", () => {
    it("should accept Ether and increase balance", async () => {
      const initialBalance = await leucoplast.getBalance();
      const value = ethers.utils.parseEther("2");

      await leucoplast.send({ value });
      expect(await leucoplast.getBalance()).to.be.gt(initialBalance);
    });
  });

  describe("Get Balance Functionality", () => {
    it("should return the correct balance after deposits and withdrawals", async () => {
      // Fund the contract
      await leucoplast.send({ value: ethers.utils.parseEther("10") });

      // Withdraw some amount
      const withdrawAmount = ethers.utils.parseEther("3");
      await leucoplast
        .connect(cellMember1)
        .withdraw(cellMember1, withdrawAmount);

      expect(await leucoplast.getBalance()).to.equal(
        ethers.utils.parseEther("7")
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero withdrawal amount", async () => {
      await expect(leucoplast.connect(cellMember1).withdraw(cellMember1, 0)).to
        .not.be.reverted;
    });

    it("should allow multiple withdrawals as long as each is within limit", async () => {
      const recipient = cellMember1;
      const amountEach = ethers.utils.parseEther("2");

      // Initial fund
      await leucoplast.send({ value: ethers.utils.parseEther("10") });

      // First withdrawal
      await leucoplast.connect(cellMember1).withdraw(recipient, amountEach);

      // Second withdrawal
      await leucoplast.connect(cellMember1).withdraw(recipient, amountEach);

      expect(await leucoplast.getBalance()).to.equal(
        ethers.utils.parseEther("6")
      );
    });
  });
});
