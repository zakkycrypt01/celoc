const { ethers } = require("hardhat");

// Replace these with your deployed contract addresses
const ESCROW_ADDRESS = "YOUR_ESCROW_CONTRACT_ADDRESS";
const CUSD_ADDRESS = "YOUR_CUSD_TOKEN_ADDRESS";

async function main() {
  console.log("Starting contract interaction demo...\n");

  const [owner, buyer, farmer] = await ethers.getSigners();
  
  console.log("Accounts:");
  console.log("Owner:", owner.address);
  console.log("Buyer:", buyer.address);
  console.log("Farmer:", farmer.address);

  // Get contract instances
  const escrow = await ethers.getContractAt("TransAgriEscrow", ESCROW_ADDRESS);
  const cUSD = await ethers.getContractAt("MockERC20", CUSD_ADDRESS); // Use IERC20 for mainnet

  console.log("\n--- Contract Information ---");
  console.log("Escrow Contract:", await escrow.getAddress());
  console.log("cUSD Token:", await escrow.cUSD());
  console.log("Platform Fee:", (await escrow.platformFee()).toString(), "basis points");
  console.log("Total Orders:", (await escrow.getOrderCount()).toString());

  // Demo values
  const orderAmount = ethers.parseEther("100"); // 100 cUSD
  const cropListingId = "crop-listing-001";

  console.log("\n--- Demo Transaction Flow ---");

  try {
    // 1. Create Order
    console.log("\n1. Creating order...");
    const createTx = await escrow.connect(buyer).createOrder(
      cropListingId,
      farmer.address,
      orderAmount
    );
    const createReceipt = await createTx.wait();
    
    const orderCreatedEvent = createReceipt.logs.find((log) => {
      try {
        const parsed = escrow.interface.parseLog(log);
        return parsed.name === "OrderCreated";
      } catch {
        return false;
      }
    });
    
    const parsedEvent = escrow.interface.parseLog(orderCreatedEvent);
    const orderId = parsedEvent.args.orderId;
    
    console.log("✅ Order created with ID:", orderId.toString());

    // 2. Get order details
    const order = await escrow.getOrder(orderId);
    console.log("Order Details:");
    console.log("  - Buyer:", order.buyer);
    console.log("  - Farmer:", order.farmer);
    console.log("  - Amount:", ethers.formatEther(order.amount), "cUSD");
    console.log("  - Platform Fee:", ethers.formatEther(order.platformFeeAmount), "cUSD");
    console.log("  - Status:", getOrderStatusName(order.status));

    // 3. Fund Order
    console.log("\n2. Funding order...");
    const totalAmount = order.amount + order.platformFeeAmount;
    
    // Check buyer balance
    const buyerBalance = await cUSD.balanceOf(buyer.address);
    console.log("Buyer cUSD balance:", ethers.formatEther(buyerBalance));
    
    if (buyerBalance < totalAmount) {
      console.log("❌ Insufficient balance. Need to fund buyer account first.");
      return;
    }
    
    // Approve and fund
    await cUSD.connect(buyer).approve(await escrow.getAddress(), totalAmount);
    console.log("✅ Approved spending");
    
    const fundTx = await escrow.connect(buyer).fundOrder(orderId);
    await fundTx.wait();
    console.log("✅ Order funded");

    // 4. Mark as Shipped
    console.log("\n3. Marking order as shipped...");
    const deliveryDetails = "Tracking #ABC123 - Express delivery via FastShip";
    const shipTx = await escrow.connect(farmer).markShipped(orderId, deliveryDetails);
    await shipTx.wait();
    console.log("✅ Order marked as shipped");
    console.log("Delivery details:", deliveryDetails);

    // 5. Confirm Delivery
    console.log("\n4. Confirming delivery...");
    const farmerBalanceBefore = await cUSD.balanceOf(farmer.address);
    console.log("Farmer balance before:", ethers.formatEther(farmerBalanceBefore), "cUSD");
    
    const confirmTx = await escrow.connect(buyer).confirmDelivery(orderId);
    await confirmTx.wait();
    console.log("✅ Delivery confirmed");

    const farmerBalanceAfter = await cUSD.balanceOf(farmer.address);
    console.log("Farmer balance after:", ethers.formatEther(farmerBalanceAfter), "cUSD");
    console.log("Farmer received:", ethers.formatEther(farmerBalanceAfter - farmerBalanceBefore), "cUSD");

    // 6. Final order status
    const finalOrder = await escrow.getOrder(orderId);
    console.log("\nFinal order status:", getOrderStatusName(finalOrder.status));
    
    // 7. Platform fees
    const totalPlatformFees = await escrow.totalPlatformFees();
    console.log("Total platform fees accumulated:", ethers.formatEther(totalPlatformFees), "cUSD");

    console.log("\n🎉 Demo completed successfully!");

  } catch (error) {
    console.error("❌ Error during demo:", error.message);
    
    // Common error solutions
    if (error.message.includes("Only buyer can")) {
      console.log("💡 Make sure you're using the correct account for this operation");
    } else if (error.message.includes("insufficient allowance")) {
      console.log("💡 Make sure to approve the escrow contract to spend your cUSD");
    } else if (error.message.includes("transfer amount exceeds balance")) {
      console.log("💡 Make sure the account has sufficient cUSD balance");
    }
  }
}

function getOrderStatusName(status) {
  const statusNames = [
    "Created",
    "Funded", 
    "Shipped",
    "Delivered",
    "Disputed",
    "Completed",
    "Cancelled",
    "Refunded"
  ];
  return statusNames[status] || "Unknown";
}

// Helper function to display order details
async function displayOrderDetails(escrow, orderId) {
  const order = await escrow.getOrder(orderId);
  console.log(`\nOrder #${orderId}:`);
  console.log(`  Crop Listing: ${order.cropListingId}`);
  console.log(`  Buyer: ${order.buyer}`);
  console.log(`  Farmer: ${order.farmer}`);
  console.log(`  Amount: ${ethers.formatEther(order.amount)} cUSD`);
  console.log(`  Platform Fee: ${ethers.formatEther(order.platformFeeAmount)} cUSD`);
  console.log(`  Status: ${getOrderStatusName(order.status)}`);
  console.log(`  Created: ${new Date(Number(order.createdAt) * 1000).toLocaleString()}`);
  
  if (order.deliveryDeadline > 0) {
    console.log(`  Delivery Deadline: ${new Date(Number(order.deliveryDeadline) * 1000).toLocaleString()}`);
  }
  
  if (order.deliveryDetails) {
    console.log(`  Delivery Details: ${order.deliveryDetails}`);
  }
}

// Export for use in other scripts
module.exports = {
  main,
  getOrderStatusName,
  displayOrderDetails
};

// Run if called directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
