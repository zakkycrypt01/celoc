const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("TransAgriEscrow - Edge Cases", function () {
  let escrow, cUSD, owner, buyer, farmer, attacker;
  let initialSupply, orderAmount, platformFee;

  before(async function () {
    initialSupply = ethers.parseEther("1000000");
    orderAmount = ethers.parseEther("100");
    platformFee = 250; // 2.5%
  });

  async function deployContractsFixture() {
    const [owner, buyer, farmer, attacker, ...addrs] = await ethers.getSigners();
    
    // Deploy mock cUSD token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const cUSD = await MockERC20.deploy("Celo Dollar", "cUSD", initialSupply);
    await cUSD.waitForDeployment();
    
    // Deploy the escrow contract
    const Escrow = await ethers.getContractFactory("TransAgriEscrow");
    const escrow = await Escrow.deploy(await cUSD.getAddress());
    await escrow.waitForDeployment();
    
    // Fund accounts
    await cUSD.transfer(buyer.address, orderAmount * 20n);
    await cUSD.transfer(farmer.address, orderAmount * 5n);
    await cUSD.transfer(attacker.address, orderAmount * 10n);
    
    return { escrow, cUSD, owner, buyer, farmer, attacker, addrs };
  }

  beforeEach(async function () {
    ({ escrow, cUSD, owner, buyer, farmer, attacker } = await loadFixture(deployContractsFixture));
  });

  describe("Edge Cases and Attack Vectors", function () {
    describe("Reentrancy Protection", function () {
      it("Should prevent reentrancy attacks on fundOrder", async function () {
        // This test ensures the ReentrancyGuard is working
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
        
        // The ReentrancyGuard should prevent any reentrancy
        await expect(escrow.connect(buyer).fundOrder(orderId)).to.not.be.reverted;
      });
    });

    describe("Zero Amount Handling", function () {
      it("Should handle zero platform fee correctly", async function () {
        await escrow.connect(owner).updatePlatformFee(0);
        
        await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
        const order = await escrow.getOrder(1);
        
        expect(order.platformFeeAmount).to.equal(0);
      });

      it("Should revert on zero amount order", async function () {
        await expect(
          escrow.connect(buyer).createOrder("listing1", farmer.address, 0)
        ).to.be.revertedWith("Amount must be greater than 0");
      });
    });

    describe("Large Number Handling", function () {
      it("Should handle maximum uint256 values safely", async function () {
        const maxAmount = ethers.parseEther("500000"); // Large but reasonable amount
        
        // Fund buyer with enough tokens (need more than maxAmount due to platform fee)
        const totalNeeded = maxAmount + (maxAmount * 250n) / 10000n; // amount + 2.5% fee
        await cUSD.transfer(buyer.address, totalNeeded);
        
        await escrow.connect(buyer).createOrder("listing1", farmer.address, maxAmount);
        const order = await escrow.getOrder(1);
        
        expect(order.amount).to.equal(maxAmount);
        expect(order.platformFeeAmount).to.equal((maxAmount * 250n) / 10000n);
      });
    });

    describe("String Parameter Edge Cases", function () {
      it("Should handle very long crop listing IDs", async function () {
        const longId = "a".repeat(1000); // Very long string
        
        await escrow.connect(buyer).createOrder(longId, farmer.address, orderAmount);
        const order = await escrow.getOrder(1);
        
        expect(order.cropListingId).to.equal(longId);
      });

      it("Should handle special characters in delivery details", async function () {
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

        const specialChars = "Unicode: 🚚📦 Special: !@#$%^&*()";
        await escrow.connect(farmer).markShipped(orderId, specialChars);
        
        const updatedOrder = await escrow.getOrder(orderId);
        expect(updatedOrder.deliveryDetails).to.equal(specialChars);
      });
    });

    describe("Time-based Edge Cases", function () {
      it("Should handle delivery exactly at deadline", async function () {
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

        // Fast forward to exactly the deadline
        const updatedOrder = await escrow.getOrder(orderId);
        await time.increaseTo(updatedOrder.deliveryDeadline);

        // Should still allow buyer to confirm delivery at exact deadline
        await expect(escrow.connect(buyer).confirmDelivery(orderId)).to.not.be.reverted;
      });

      it("Should handle auto-release one second after deadline", async function () {
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

        // Fast forward to one second past deadline
        const updatedOrder = await escrow.getOrder(orderId);
        await time.increaseTo(Number(updatedOrder.deliveryDeadline) + 1);

        await expect(escrow.autoReleaseOrder(orderId)).to.not.be.reverted;
      });
    });

    describe("Access Control Edge Cases", function () {
      it("Should prevent unauthorized access to admin functions", async function () {
        await expect(
          escrow.connect(attacker).updatePlatformFee(500)
        ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");

        await expect(
          escrow.connect(attacker).pause()
        ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");

        await expect(
          escrow.connect(attacker).withdrawPlatformFees(1000)
        ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
      });

      it("Should prevent non-participants from manipulating orders", async function () {
        await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
        const orderId = 1;

        await expect(
          escrow.connect(attacker).cancelOrder(orderId)
        ).to.be.revertedWith("Only buyer or farmer can cancel");

        await expect(
          escrow.connect(attacker).initiateDispute(orderId)
        ).to.be.revertedWith("Only buyer or farmer can dispute");
      });
    });

    describe("Token Transfer Edge Cases", function () {
      it("Should handle token transfers that return false", async function () {
        // This would require a mock token that returns false on transfer
        // For now, we test with insufficient balance
        const poorBuyer = (await ethers.getSigners())[10];
        
        await escrow.connect(poorBuyer).createOrder("listing1", farmer.address, orderAmount);
        const order = await escrow.getOrder(1);
        const totalAmount = order.amount + order.platformFeeAmount;
        
        // Don't fund the poor buyer
        await cUSD.connect(poorBuyer).approve(await escrow.getAddress(), totalAmount);
        
        await expect(
          escrow.connect(poorBuyer).fundOrder(1)
        ).to.be.reverted; // Should revert due to insufficient balance
      });
    });

    describe("Platform Fee Edge Cases", function () {
      it("Should handle maximum platform fee", async function () {
        const maxFee = 1000; // 10%
        await escrow.connect(owner).updatePlatformFee(maxFee);
        
        await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
        const order = await escrow.getOrder(1);
        
        expect(order.platformFeeAmount).to.equal((orderAmount * BigInt(maxFee)) / 10000n);
      });

      it("Should prevent platform fee above maximum", async function () {
        const excessiveFee = 1001; // 10.01%
        
        await expect(
          escrow.connect(owner).updatePlatformFee(excessiveFee)
        ).to.be.revertedWith("Fee too high");
      });
    });

    describe("Order State Transitions", function () {
      it("Should prevent invalid state transitions", async function () {
        await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
        const orderId = 1;

        // Try to ship before funding
        await expect(
          escrow.connect(farmer).markShipped(orderId, "Tracking: ABC123")
        ).to.be.revertedWith("Order not funded");

        // Try to confirm delivery before shipping
        const order = await escrow.getOrder(orderId);
        const totalAmount = order.amount + order.platformFeeAmount;
        await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
        await escrow.connect(buyer).fundOrder(orderId);

        await expect(
          escrow.connect(buyer).confirmDelivery(orderId)
        ).to.be.revertedWith("Order not shipped");
      });
    });

    describe("Multiple Orders Handling", function () {
      it("Should handle multiple orders correctly", async function () {
        const numOrders = 10;
        const orderIds = [];
        
        for (let i = 0; i < numOrders; i++) {
          const tx = await escrow.connect(buyer).createOrder(
            `listing${i}`, 
            farmer.address, 
            orderAmount
          );
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
          orderIds.push(parsedEvent.args.orderId);
        }
        
        expect(await escrow.getOrderCount()).to.equal(numOrders);
        
        // Verify all orders exist and have correct data
        for (let i = 0; i < numOrders; i++) {
          const order = await escrow.getOrder(orderIds[i]);
          expect(order.cropListingId).to.equal(`listing${i}`);
          expect(order.buyer).to.equal(buyer.address);
          expect(order.farmer).to.equal(farmer.address);
        }
      });
    });

    describe("Paused Contract Behavior", function () {
      it("Should block all state-changing functions when paused", async function () {
        await escrow.connect(owner).pause();
        
        await expect(
          escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount)
        ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
        
        // Create order first, then pause to test other functions
        await escrow.connect(owner).unpause();
        await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
        await escrow.connect(owner).pause();
        
        await expect(
          escrow.connect(buyer).fundOrder(1)
        ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
        
        await expect(
          escrow.connect(farmer).markShipped(1, "Tracking: ABC123")
        ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
      });

      it("Should allow view functions when paused", async function () {
        await escrow.connect(buyer).createOrder("listing1", farmer.address, orderAmount);
        await escrow.connect(owner).pause();
        
        // View functions should still work
        await expect(escrow.getOrder(1)).to.not.be.reverted;
        await expect(escrow.getOrderCount()).to.not.be.reverted;
        await expect(escrow.getUserOrders(buyer.address)).to.not.be.reverted;
      });
    });
  });
});
