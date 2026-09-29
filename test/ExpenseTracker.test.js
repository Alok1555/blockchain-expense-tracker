const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// Amounts are stored in paise: 1 rupee = 100 paise.
const rupees = (value) => BigInt(Math.round(value * 100));

describe("ExpenseTracker", function () {
  async function deployFixture() {
    const [alice, bob] = await ethers.getSigners();
    const tracker = await ethers.deployContract("ExpenseTracker");
    return { tracker, alice, bob };
  }

  describe("addExpense", function () {
    it("records the expense and emits its ID", async function () {
      const { tracker, alice } = await loadFixture(deployFixture);
      const date = BigInt(await time.latest()) - 3600n;

      await expect(tracker.connect(alice).addExpense("Lunch", "Food", rupees(250.75), date))
        .to.emit(tracker, "ExpenseAdded")
        .withArgs(alice.address, 1n, "Food", 25075n, date);

      const [expense] = await tracker.connect(alice).getExpenses();
      expect(expense.id).to.equal(1n);
      expect(expense.description).to.equal("Lunch");
      expect(expense.category).to.equal("Food");
      expect(expense.amount).to.equal(25075n);
      expect(expense.date).to.equal(date);
      expect(expense.recordedAt).to.be.greaterThanOrEqual(date);
    });

    it("uses the current time when the date is 0", async function () {
      const { tracker } = await loadFixture(deployFixture);
      await tracker.addExpense("Bus", "Travel", rupees(20), 0);
      const [expense] = await tracker.getExpenses();
      expect(expense.date).to.equal(expense.recordedAt);
      expect(expense.date).to.equal(BigInt(await time.latest()));
    });

    it("validates the input", async function () {
      const { tracker } = await loadFixture(deployFixture);
      await expect(tracker.addExpense("", "Food", 100, 0)).to.be.revertedWith("Description is required");
      await expect(tracker.addExpense("x".repeat(101), "Food", 100, 0)).to.be.revertedWith("Description is too long");
      await expect(tracker.addExpense("Lunch", "", 100, 0)).to.be.revertedWith("Category is required");
      await expect(tracker.addExpense("Lunch", "x".repeat(31), 100, 0)).to.be.revertedWith("Category is too long");
      await expect(tracker.addExpense("Lunch", "Food", 0, 0)).to.be.revertedWith("Amount must be greater than zero");
      const nextWeek = BigInt(await time.latest()) + 7n * 86400n;
      await expect(tracker.addExpense("Lunch", "Food", 100, nextWeek)).to.be.revertedWith(
        "Date cannot be in the future"
      );
    });
  });

  describe("getExpenses / getTotal", function () {
    it("keeps a running total", async function () {
      const { tracker, alice } = await loadFixture(deployFixture);
      expect(await tracker.connect(alice).getTotal()).to.equal(0n);

      await tracker.connect(alice).addExpense("Lunch", "Food", rupees(250.75), 0);
      await tracker.connect(alice).addExpense("Books", "Education", rupees(1200), 0);
      await tracker.connect(alice).addExpense("Dinner", "Food", rupees(99.25), 0);

      expect(await tracker.connect(alice).getTotal()).to.equal(rupees(1550));
      expect(await tracker.connect(alice).getExpenseCount()).to.equal(3n);
      expect(await tracker.connect(alice).getTotalByCategory("Food")).to.equal(rupees(350));
      expect(await tracker.connect(alice).getTotalByCategory("Rent")).to.equal(0n);

      const list = await tracker.connect(alice).getExpenses();
      expect(list.map((e) => e.id)).to.deep.equal([1n, 2n, 3n]);
      expect(list.reduce((sum, e) => sum + e.amount, 0n)).to.equal(await tracker.connect(alice).getTotal());
    });

    it("keeps each wallet's ledger separate", async function () {
      const { tracker, alice, bob } = await loadFixture(deployFixture);
      await tracker.connect(alice).addExpense("Lunch", "Food", rupees(100), 0);
      await tracker.connect(bob).addExpense("Taxi", "Travel", rupees(300), 0);
      await tracker.connect(bob).addExpense("Movie", "Fun", rupees(200), 0);

      expect(await tracker.connect(alice).getTotal()).to.equal(rupees(100));
      expect(await tracker.connect(bob).getTotal()).to.equal(rupees(500));
      expect(await tracker.connect(alice).getExpenses()).to.have.length(1);
      expect((await tracker.connect(bob).getExpenses())[0].id).to.equal(1n);
    });

    it("handles very large amounts without overflow issues", async function () {
      const { tracker } = await loadFixture(deployFixture);
      const big = 10n ** 30n;
      await tracker.addExpense("Big", "Other", big, 0);
      await tracker.addExpense("Big", "Other", big, 0);
      expect(await tracker.getTotal()).to.equal(2n * big);
    });
  });
});
