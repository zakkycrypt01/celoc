const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("TransAgriEscrow", function () {
  let escrow, cUSD, owner, buyer, farmer, admin;
  let initialSupply, orderAmount, platformFee;

  before(async function () {
    initialSupply = ethers.parseEther("1000000");
    orderAmount = ethers.parseEther("100");
    platformFee = 250; // 2.5%
  });

  async function deployContractsFixture() {
    const [owner, buyer, farmer, admin, ...addrs] = await ethers.getSigners();
    
    // Deploy mock cUSD token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const cUSD = await MockERC20.deploy("Celo Dollar", "cUSD", initialSupply);
    await cUSD.waitForDeployment();
    
    // Deploy the escrow contract
    const Escrow = await ethers.getContractFactory("TransAgriEscrow");
    const escrow = await Escrow.deploy(await cUSD.getAddress());
    await escrow.waitForDeployment();
    
    // Fund buyer and farmer with cUSD
    await cUSD.transfer(buyer.address, orderAmount * 20n);
    await cUSD.transfer(farmer.address, orderAmount * 5n);
    
    return { escrow, cUSD, owner, buyer, farmer, admin, addrs };
  }

  beforeEach(async function () {
    ({ escrow, cUSD, owner, buyer, farmer, admin } = await loadFixture(deployContractsFixture));
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await escrow.owner()).to.equal(owner.address);
    });

    it("Should set the correct cUSD token address", async function () {
      expect(await escrow.cUSD()).to.equal(await cUSD.getAddress());
    });

    it("Should initialize platform fee correctly", async function () {
      expect(await escrow.platformFee()).to.equal(platformFee);
    });

    it("Should start with zero orders", async function () {
      expect(await escrow.getOrderCount()).to.equal(0);
    });
  });

  describe("Order Creation", function () {
    it("Should create an order successfully", async function () {
      const tx = await escrow
        .connect(buyer)
        .createOrder("listing1", farmer.address, orderAmount);
      
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      
      expect(event).to.exist;
      const parsedEvent = escrow.interface.parseLog(event);
      const orderId = parsedEvent.args.orderId;
      
      const order = await escrow.getOrder(orderId);
      expect(order.buyer).to.equal(buyer.address);
      expect(order.farmer).to.equal(farmer.address);
      expect(order.amount).to.equal(orderAmount);
      expect(order.status).to.equal(0); // OrderStatus.Created
      expect(order.cropListingId).to.equal("listing1");
    });

    it("Should increment order counter", async function () {
      await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      expect(await escrow.getOrderCount()).to.equal(1);
      
      await escrow.connect(buyer).createOrder("listing2", farmer.address, orderAmount);
      expect(await escrow.getOrderCount()).to.equal(2);
    });

    it("Should revert if farmer address is zero", async function () {
      await expect(
        escrow.connect(buyer).createOrder("listing1", ethers.ZeroAddress, orderAmount)
      ).to.be.revertedWith("Invalid farmer address");
    });

    it("Should revert if buyer and farmer are the same", async function () {
      await expect(
        escrow.connect(buyer).createOrder("listing1", buyer.address, orderAmount)
      ).to.be.revertedWith("Buyer cannot be farmer");
    });

    it("Should revert if amount is zero", async function () {
      await expect(
        escrow.connect(buyer).createOrder("listing1", farmer.address, 0)
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should revert if crop listing ID is empty", async function () {
      await expect(
        escrow.connect(buyer).createOrder("", farmer.address, orderAmount)
      ).to.be.revertedWith("Crop listing ID required");
    });

    it("Should calculate platform fee correctly", async function () {
      await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const order = await escrow.getOrder(1);
      const expectedFee = (orderAmount * 250n) / 10000n; // 2.5%
      expect(order.platformFeeAmount).to.equal(expectedFee);
    });
  });

  describe("Order Funding", function () {
    let orderId;

    beforeEach(async function () {
      const tx = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = escrow.interface.parseLog(event);
      orderId = parsedEvent.args.orderId;
    });

    it("Should fund order successfully", async function () {
      const order = await escrow.getOrder(orderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      
      const tx = await escrow.connect(buyer).fundOrder(orderId);
      const receipt = await tx.wait();
      
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderFunded";
        } catch {
          return false;
        }
      });
      
      expect(event).to.exist;
      
      const updatedOrder = await escrow.getOrder(orderId);
      expect(updatedOrder.status).to.equal(1); // OrderStatus.Funded
      expect(updatedOrder.deliveryDeadline).to.be.gt(0);
    });

    it("Should revert if not called by buyer", async function () {
      const order = await escrow.getOrder(orderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      
      await cUSD.connect(farmer).approve(await escrow.getAddress(), totalAmount);
      
      await expect(
        escrow.connect(farmer).fundOrder(orderId)
      ).to.be.revertedWith("Only buyer can fund order");
    });

    it("Should revert if order already funded", async function () {
      const order = await escrow.getOrder(orderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount * 2n);
      await escrow.connect(buyer).fundOrder(orderId);
      
      await expect(
        escrow.connect(buyer).fundOrder(orderId)
      ).to.be.revertedWith("Order already funded or invalid");
    });

    it("Should transfer correct amount to escrow contract", async function () {
      const order = await escrow.getOrder(orderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      
      const initialBalance = await cUSD.balanceOf(await escrow.getAddress());
      
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      await escrow.connect(buyer).fundOrder(orderId);
      
      const finalBalance = await cUSD.balanceOf(await escrow.getAddress());
      expect(finalBalance - initialBalance).to.equal(totalAmount);
    });
  });

  describe("Order Shipping", function () {
    let orderId;

    beforeEach(async function () {
      // Create and fund order
      const tx = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = escrow.interface.parseLog(event);
      orderId = parsedEvent.args.orderId;

      const order = await escrow.getOrder(orderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      await escrow.connect(buyer).fundOrder(orderId);
    });

    it("Should mark order as shipped successfully", async function () {
      const deliveryDetails = "Tracking: ABC123, Courier: FastShip";
      
      const tx = await escrow.connect(farmer).markShipped(orderId, deliveryDetails);
      const receipt = await tx.wait();
      
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderShipped";
        } catch {
          return false;
        }
      });
      
      expect(event).to.exist;
      
      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(2); // OrderStatus.Shipped
      expect(order.farmerShipped).to.be.true;
      expect(order.deliveryDetails).to.equal(deliveryDetails);
    });

    it("Should revert if not called by farmer", async function () {
      await expect(
        escrow.connect(buyer).markShipped(orderId, "Tracking: ABC123")
      ).to.be.revertedWith("Only farmer can mark as shipped");
    });

    it("Should revert if order not funded", async function () {
      // Create unfunded order
      const tx = await escrow.connect(buyer).createOrder("listing2", farmer.address, orderAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = escrow.interface.parseLog(event);
      const newOrderId = parsedEvent.args.orderId;

      await expect(
        escrow.connect(farmer).markShipped(newOrderId, "Tracking: ABC123")
      ).to.be.revertedWith("Order not funded");
    });
  });

  describe("Order Delivery Confirmation", function () {
    let orderId;

    beforeEach(async function () {
      // Create, fund, and ship order
      const tx = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = escrow.interface.parseLog(event);
      orderId = parsedEvent.args.orderId;

      const order = await escrow.getOrder(orderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      await escrow.connect(buyer).fundOrder(orderId);
      await escrow.connect(farmer).markShipped(orderId, "Tracking: ABC123");
    });

    it("Should confirm delivery and complete order", async function () {
      const initialFarmerBalance = await cUSD.balanceOf(farmer.address);
      const initialPlatformFees = await escrow.totalPlatformFees();
      
      const tx = await escrow.connect(buyer).confirmDelivery(orderId);
      const receipt = await tx.wait();
      
      const deliveredEvent = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderDelivered";
        } catch {
          return false;
        }
      });
      
      const completedEvent = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCompleted";
        } catch {
          return false;
        }
      });
      
      expect(deliveredEvent).to.exist;
      expect(completedEvent).to.exist;
      
      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(5); // OrderStatus.Completed
      expect(order.buyerConfirmed).to.be.true;
      
      // Check farmer received payment
      const finalFarmerBalance = await cUSD.balanceOf(farmer.address);
      expect(finalFarmerBalance - initialFarmerBalance).to.equal(orderAmount);
      
      // Check platform fees accumulated
      const finalPlatformFees = await escrow.totalPlatformFees();
      expect(finalPlatformFees - initialPlatformFees).to.equal(order.platformFeeAmount);
    });

    it("Should revert if not called by buyer", async function () {
      await expect(
        escrow.connect(farmer).confirmDelivery(orderId)
      ).to.be.revertedWith("Only buyer can confirm delivery");
    });

    it("Should revert if order not shipped", async function () {
      // Create and fund but don't ship
      const tx = await escrow.connect(buyer).createOrder("listing2", farmer.address, orderAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = escrow.interface.parseLog(event);
      const newOrderId = parsedEvent.args.orderId;

      const order = await escrow.getOrder(newOrderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      await escrow.connect(buyer).fundOrder(newOrderId);

      await expect(
        escrow.connect(buyer).confirmDelivery(newOrderId)
      ).to.be.revertedWith("Order not shipped");
    });
  });

  describe("Auto Release", function () {
    let orderId;

    beforeEach(async function () {
      // Create, fund, and ship order
      const tx = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = escrow.interface.parseLog(event);
      orderId = parsedEvent.args.orderId;

      const order = await escrow.getOrder(orderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      await escrow.connect(buyer).fundOrder(orderId);
      await escrow.connect(farmer).markShipped(orderId, "Tracking: ABC123");
    });

    it("Should auto-release funds after delivery deadline", async function () {
      // Fast forward time past delivery deadline (14 days)
      await time.increase(14 * 24 * 60 * 60 + 1); // 14 days + 1 second
      
      const initialFarmerBalance = await cUSD.balanceOf(farmer.address);
      
      await escrow.autoReleaseOrder(orderId);
      
      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(5); // OrderStatus.Completed
      
      const finalFarmerBalance = await cUSD.balanceOf(farmer.address);
      expect(finalFarmerBalance - initialFarmerBalance).to.equal(orderAmount);
    });

    it("Should revert if delivery deadline not reached", async function () {
      await expect(
        escrow.autoReleaseOrder(orderId)
      ).to.be.revertedWith("Delivery deadline not reached");
    });
  });

  describe("Disputes", function () {
    let orderId;

    beforeEach(async function () {
      // Create, fund, and ship order
      const tx = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = escrow.interface.parseLog(event);
      orderId = parsedEvent.args.orderId;

      const order = await escrow.getOrder(orderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      await escrow.connect(buyer).fundOrder(orderId);
      await escrow.connect(farmer).markShipped(orderId, "Tracking: ABC123");
    });

    it("Should allow buyer to initiate dispute", async function () {
      const tx = await escrow.connect(buyer).initiateDispute(orderId);
      const receipt = await tx.wait();
      
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderDisputed";
        } catch {
          return false;
        }
      });
      
      expect(event).to.exist;
      
      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(4); // OrderStatus.Disputed
      expect(order.disputeTimeout).to.be.gt(0);
    });

    it("Should allow farmer to initiate dispute", async function () {
      await escrow.connect(farmer).initiateDispute(orderId);
      
      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(4); // OrderStatus.Disputed
    });

    it("Should revert if unauthorized user tries to dispute", async function () {
      await expect(
        escrow.connect(admin).initiateDispute(orderId)
      ).to.be.revertedWith("Only buyer or farmer can dispute");
    });

    it("Should resolve dispute in favor of buyer", async function () {
      await escrow.connect(buyer).initiateDispute(orderId);
      
      const initialBuyerBalance = await cUSD.balanceOf(buyer.address);
      const order = await escrow.getOrder(orderId);
      const refundAmount = order.amount + order.platformFeeAmount;
      
      await escrow.connect(owner).resolveDispute(orderId, true); // Favor buyer
      
      const finalBuyerBalance = await cUSD.balanceOf(buyer.address);
      expect(finalBuyerBalance - initialBuyerBalance).to.equal(refundAmount);
      
      const updatedOrder = await escrow.getOrder(orderId);
      expect(updatedOrder.status).to.equal(7); // OrderStatus.Refunded
    });

    it("Should resolve dispute in favor of farmer", async function () {
      await escrow.connect(buyer).initiateDispute(orderId);
      
      const initialFarmerBalance = await cUSD.balanceOf(farmer.address);
      
      await escrow.connect(owner).resolveDispute(orderId, false); // Favor farmer
      
      const finalFarmerBalance = await cUSD.balanceOf(farmer.address);
      expect(finalFarmerBalance - initialFarmerBalance).to.equal(orderAmount);
      
      const updatedOrder = await escrow.getOrder(orderId);
      expect(updatedOrder.status).to.equal(5); // OrderStatus.Completed
    });

    it("Should revert if non-owner tries to resolve dispute", async function () {
      await escrow.connect(buyer).initiateDispute(orderId);
      
      await expect(
        escrow.connect(buyer).resolveDispute(orderId, true)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  describe("Order Cancellation", function () {
    it("Should allow buyer to cancel unfunded order", async function () {
      const tx = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = escrow.interface.parseLog(event);
      const orderId = parsedEvent.args.orderId;

      await escrow.connect(buyer).cancelOrder(orderId);
      
      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(6); // OrderStatus.Cancelled
    });

    it("Should allow farmer to cancel unfunded order", async function () {
      const tx = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = escrow.interface.parseLog(event);
      const orderId = parsedEvent.args.orderId;

      await escrow.connect(farmer).cancelOrder(orderId);
      
      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(6); // OrderStatus.Cancelled
    });

    it("Should revert if trying to cancel funded order", async function () {
      const tx = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = escrow.interface.parseLog(event);
      const orderId = parsedEvent.args.orderId;

      const order = await escrow.getOrder(orderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      await escrow.connect(buyer).fundOrder(orderId);

      await expect(
        escrow.connect(buyer).cancelOrder(orderId)
      ).to.be.revertedWith("Can only cancel unfunded orders");
    });
  });

  describe("Platform Fee Management", function () {
    it("Should allow owner to update platform fee", async function () {
      const newFee = 500; // 5%
      await escrow.connect(owner).updatePlatformFee(newFee);
      expect(await escrow.platformFee()).to.equal(newFee);
    });

    it("Should revert if fee is too high", async function () {
      const highFee = 1500; // 15% (above MAX_FEE of 10%)
      await expect(
        escrow.connect(owner).updatePlatformFee(highFee)
      ).to.be.revertedWith("Fee too high");
    });

    it("Should allow owner to withdraw platform fees", async function () {
      // Create and complete an order to accumulate fees
      const tx = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = escrow.interface.parseLog(event);
      const orderId = parsedEvent.args.orderId;

      const order = await escrow.getOrder(orderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      await escrow.connect(buyer).fundOrder(orderId);
      await escrow.connect(farmer).markShipped(orderId, "Tracking: ABC123");
      await escrow.connect(buyer).confirmDelivery(orderId);

      const platformFees = await escrow.totalPlatformFees();
      const initialOwnerBalance = await cUSD.balanceOf(owner.address);
      
      await escrow.connect(owner).withdrawPlatformFees(platformFees);
      
      const finalOwnerBalance = await cUSD.balanceOf(owner.address);
      expect(finalOwnerBalance - initialOwnerBalance).to.equal(platformFees);
      expect(await escrow.totalPlatformFees()).to.equal(0);
    });

    it("Should revert if trying to withdraw more than available fees", async function () {
      const excessiveAmount = ethers.parseEther("1000");
      await expect(
        escrow.connect(owner).withdrawPlatformFees(excessiveAmount)
      ).to.be.revertedWith("Insufficient platform fees");
    });
  });

  describe("Pause Functionality", function () {
    it("Should allow owner to pause and unpause contract", async function () {
      await escrow.connect(owner).pause();
      
      await expect(
        escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount)
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
      
      await escrow.connect(owner).unpause();
      
      // Should work after unpause
      await expect(
        escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount)
      ).to.not.be.reverted;
    });

    it("Should revert if non-owner tries to pause", async function () {
      await expect(
        escrow.connect(buyer).pause()
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  describe("View Functions", function () {
    let orderId;

    beforeEach(async function () {
      const tx = await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed.name === "OrderCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = escrow.interface.parseLog(event);
      orderId = parsedEvent.args.orderId;
    });

    it("Should return user orders correctly", async function () {
      const buyerOrders = await escrow.getUserOrders(buyer.address);
      const farmerOrders = await escrow.getUserOrders(farmer.address);
      
      expect(buyerOrders).to.have.lengthOf(1);
      expect(farmerOrders).to.have.lengthOf(1);
      expect(buyerOrders[0]).to.equal(orderId);
      expect(farmerOrders[0]).to.equal(orderId);
    });

    it("Should check if order is expired correctly", async function () {
      // Unfunded order should not be expired
      expect(await escrow.isOrderExpired(orderId)).to.be.false;
      
      // Fund order to set delivery deadline
      const order = await escrow.getOrder(orderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      await escrow.connect(buyer).fundOrder(orderId);
      
      // Should not be expired initially
      expect(await escrow.isOrderExpired(orderId)).to.be.false;
      
      // Fast forward past deadline
      await time.increase(14 * 24 * 60 * 60 + 1); // 14 days + 1 second
      
      // Should now be expired
      expect(await escrow.isOrderExpired(orderId)).to.be.true;
    });

    it("Should return contract balance correctly", async function () {
      const initialBalance = await escrow.getContractBalance();
      
      const order = await escrow.getOrder(orderId);
      const totalAmount = order.amount + order.platformFeeAmount;
      await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
      await escrow.connect(buyer).fundOrder(orderId);
      
      const finalBalance = await escrow.getContractBalance();
      expect(finalBalance - initialBalance).to.equal(totalAmount);
    });
  });
});
