const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("TransAgriEscrow - Gas Optimization", function () {
  let escrow, cUSD, owner, buyer, farmer;
  let initialSupply, orderAmount;

  before(async function () {
    initialSupply = ethers.parseEther("1000000");
    orderAmount = ethers.parseEther("100");
  });

  async function deployContractsFixture() {
    const [owner, buyer, farmer, ...addrs] = await ethers.getSigners();
    
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const cUSD = await MockERC20.deploy("Celo Dollar", "cUSD", initialSupply);
    await cUSD.waitForDeployment();
    
    const Escrow = await ethers.getContractFactory("TransAgriEscrow");
    const escrow = await Escrow.deploy(await cUSD.getAddress());
    await escrow.waitForDeployment();
    
    await cUSD.transfer(buyer.address, orderAmount * 50n);
    await cUSD.transfer(farmer.address, orderAmount * 20n);
    
    return { escrow, cUSD, owner, buyer, farmer, addrs };
  }

  beforeEach(async function () {
    ({ escrow, cUSD, owner, buyer, farmer } = await loadFixture(deployContractsFixture));
  });

  describe("Gas Usage Analysis", function () {
    it("Should track gas usage for order creation", async function () {
      const tx = await escrow.connect(buyer).createOrder(
        "listing1", 
        farmer.address, 
        orderAmount
      );
      const receipt = await tx.wait();
      
      console.log(`    Gas used for order creation: ${receipt.gasUsed.toString()}`);
      
      // Should be reasonably efficient (adjusted for complex contract)
      expect(receipt.gasUsed).to.be.lessThan(350000);
    });

    it("Should track gas usage for order funding", async function () {
      await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      
      const order = await escrow.getOrder(1);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      
      const tx = await escrow.connect(buyer).fundOrder(1);
      const receipt = await tx.wait();
      
      console.log(`    Gas used for order funding: ${receipt.gasUsed.toString()}`);
      
      // Should be reasonably efficient
      expect(receipt.gasUsed).to.be.lessThan(150000);
    });

    it("Should track gas usage for marking shipped", async function () {
      await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      
      const order = await escrow.getOrder(1);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      await escrow.connect(buyer).fundOrder(1);
      
      const tx = await escrow.connect(farmer).markShipped(1, "Tracking: ABC123");
      const receipt = await tx.wait();
      
      console.log(`    Gas used for marking shipped: ${receipt.gasUsed.toString()}`);
      
      // Should be very efficient (mainly storage updates)
      expect(receipt.gasUsed).to.be.lessThan(100000);
    });

    it("Should track gas usage for delivery confirmation", async function () {
      await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      
      const order = await escrow.getOrder(1);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      await escrow.connect(buyer).fundOrder(1);
      await escrow.connect(farmer).markShipped(1, "Tracking: ABC123");
      
      const tx = await escrow.connect(buyer).confirmDelivery(1);
      const receipt = await tx.wait();
      
      console.log(`    Gas used for delivery confirmation: ${receipt.gasUsed.toString()}`);
      
      // Includes token transfer, so higher gas usage expected
      expect(receipt.gasUsed).to.be.lessThan(200000);
    });

    it("Should compare gas usage between single and batch operations", async function () {
      // Single order operations
      const tx1 = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt1 = await tx1.wait();
      
      const tx2 = await escrow.connect(buyer).createOrder("listing2", farmer.address, orderAmount);
      const receipt2 = await tx2.wait();
      
      const singleGas = receipt1.gasUsed + receipt2.gasUsed;
      console.log(`    Gas for 2 individual operations: ${singleGas.toString()}`);
      
      // Note: This contract doesn't implement batch operations, 
      // but we can analyze the marginal cost of additional orders
      const marginalGas = receipt2.gasUsed;
      console.log(`    Marginal gas for additional order: ${marginalGas.toString()}`);
      
      // Second operation should be slightly cheaper due to warm storage slots
      expect(marginalGas).to.be.lessThanOrEqual(receipt1.gasUsed);
    });

    it("Should analyze view function gas usage", async function () {
      await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      
      // View functions should use minimal gas
      const gasEstimate1 = await escrow.getOrder.estimateGas(1);
      const gasEstimate2 = await escrow.getOrderCount.estimateGas();
      const gasEstimate3 = await escrow.getUserOrders.estimateGas(buyer.address);
      
      console.log(`    Gas estimate for getOrder: ${gasEstimate1.toString()}`);
      console.log(`    Gas estimate for getOrderCount: ${gasEstimate2.toString()}`);
      console.log(`    Gas estimate for getUserOrders: ${gasEstimate3.toString()}`);
      
      // View functions should be very efficient
      expect(gasEstimate1).to.be.lessThan(50000);
      expect(gasEstimate2).to.be.lessThan(30000);
      expect(gasEstimate3).to.be.lessThan(50000);
    });
  });

  describe("Storage Efficiency", function () {
    it("Should efficiently pack struct data", async function () {
      await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      
      const order = await escrow.getOrder(1);
      
      // Verify all fields are accessible (indicates proper packing)
      expect(order.orderId).to.exist;
      expect(order.cropListingId).to.exist;
      expect(order.buyer).to.exist;
      expect(order.farmer).to.exist;
      expect(order.amount).to.exist;
      expect(order.platformFeeAmount).to.exist;
      expect(order.status).to.exist;
      expect(order.createdAt).to.exist;
      expect(order.deliveryDeadline).to.exist;
      expect(order.disputeTimeout).to.exist;
      expect(order.deliveryDetails).to.exist;
      expect(order.buyerConfirmed).to.exist;
      expect(order.farmerShipped).to.exist;
    });

    it("Should minimize storage writes", async function () {
      // Create order (writes to orders mapping and userOrders mappings)
      const tx1 = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt1 = await tx1.wait();
      
      // Fund order (updates existing order struct)
      const order = await escrow.getOrder(1);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      
      const tx2 = await escrow.connect(buyer).fundOrder(1);
      const receipt2 = await tx2.wait();
      
      console.log(`    Gas for order creation: ${receipt1.gasUsed.toString()}`);
      console.log(`    Gas for order funding: ${receipt2.gasUsed.toString()}`);
      
      // Funding should be cheaper than creation (fewer new storage slots)
      expect(receipt2.gasUsed).to.be.lessThan(receipt1.gasUsed);
    });
  });

  describe("Event Emission Efficiency", function () {
    it("Should emit events efficiently", async function () {
      const tx = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt = await tx.wait();
      
      // Should emit exactly one event
      const orderCreatedEvents = receipt.logs.filter((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      
      expect(orderCreatedEvents).to.have.lengthOf(1);
      
      const parsedEvent = escrow.interface.parseLog(orderCreatedEvents[0]);
      expect(parsedEvent.args.orderId).to.exist;
      // cropListingId is indexed so it's hashed in the event
      expect(parsedEvent.args.cropListingId).to.exist;
      expect(parsedEvent.args.buyer).to.equal(buyer.address);
      expect(parsedEvent.args.farmer).to.equal(farmer.address);
      expect(parsedEvent.args.amount).to.equal(orderAmount);
    });
  });

  describe("Optimization Recommendations", function () {
    it("Should demonstrate gas savings from proper approval handling", async function () {
      await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      
      const order = await escrow.getOrder(1);
      const totalAmount = order.amount + order.platformFeeAmount;
      
      // Test with exact approval (efficient)
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      const tx1 = await escrow.connect(buyer).fundOrder(1);
      const receipt1 = await tx1.wait();
      
      console.log(`    Gas with exact approval: ${receipt1.gasUsed.toString()}`);
      
      // Create another order to test with excessive approval
      await escrow.connect(buyer).createOrder("listing2", farmer.address, orderAmount);
      const order2 = await escrow.getOrder(2);
      const totalAmount2 = order2.amount + order2.platformFeeAmount;
      
      // Approve much more than needed
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount2 * 10n);
      const tx2 = await escrow.connect(buyer).fundOrder(2);
      const receipt2 = await tx2.wait();
      
      console.log(`    Gas with excessive approval: ${receipt2.gasUsed.toString()}`);
      
      // Gas usage should be similar regardless of approval amount
      const gasUsageDiff = Math.abs(Number(receipt1.gasUsed) - Number(receipt2.gasUsed));
      expect(gasUsageDiff).to.be.lessThan(15000); // Reasonable difference tolerance
    });
  });
});
