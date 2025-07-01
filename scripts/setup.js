const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Setting up complete TransAgri Escrow environment...\n");

  const [deployer, buyer, farmer, admin] = await ethers.getSigners();
  
  console.log("📋 Account Setup:");
  console.log("Deployer/Owner:", deployer.address);
  console.log("Test Buyer:", buyer.address);
  console.log("Test Farmer:", farmer.address);
  console.log("Admin:", admin.address);

  // Deploy contracts
  console.log("\n📦 Deploying contracts...");
  
  // Deploy mock cUSD
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const initialSupply = ethers.parseEther("1000000000"); // 1B tokens
  const cUSD = await MockERC20.deploy("Celo Dollar", "cUSD", initialSupply);
  await cUSD.waitForDeployment();
  const cUSDAddress = await cUSD.getAddress();
  console.log("✅ Mock cUSD deployed to:", cUSDAddress);

  // Deploy TransAgriEscrow
  const TransAgriEscrow = await ethers.getContractFactory("TransAgriEscrow");
  const escrow = await TransAgriEscrow.deploy(cUSDAddress);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("✅ TransAgriEscrow deployed to:", escrowAddress);

  // Fund test accounts
  console.log("\n💰 Funding test accounts...");
  const fundAmount = ethers.parseEther("50000"); // 50k cUSD each
  
  await cUSD.transfer(buyer.address, fundAmount);
  await cUSD.transfer(farmer.address, fundAmount);
  await cUSD.transfer(admin.address, fundAmount);
  
  console.log(`✅ Funded buyer with ${ethers.formatEther(fundAmount)} cUSD`);
  console.log(`✅ Funded farmer with ${ethers.formatEther(fundAmount)} cUSD`);
  console.log(`✅ Funded admin with ${ethers.formatEther(fundAmount)} cUSD`);

  // Create sample orders for testing
  console.log("\n📋 Creating sample orders...");
  
  const sampleOrders = [
    {
      cropListingId: "maize-premium-001",
      amount: ethers.parseEther("250"),
      description: "Premium maize - 100kg"
    },
    {
      cropListingId: "tomatoes-organic-002", 
      amount: ethers.parseEther("150"),
      description: "Organic tomatoes - 50kg"
    },
    {
      cropListingId: "rice-basmati-003",
      amount: ethers.parseEther("300"),
      description: "Basmati rice - 200kg"
    }
  ];

  const createdOrders = [];
  
  for (let i = 0; i < sampleOrders.length; i++) {
    const order = sampleOrders[i];
    const tx = await escrow.connect(buyer).createOrder(
      order.cropListingId,
      farmer.address,
      order.amount
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
    const orderId = parsedEvent.args.orderId;
    
    createdOrders.push({
      id: orderId.toString(),
      ...order
    });
    
    console.log(`✅ Created order #${orderId}: ${order.description}`);
  }

  // Fund one order as example
  console.log("\n💳 Funding sample order...");
  const orderToFund = createdOrders[0];
  const orderDetails = await escrow.getOrder(orderToFund.id);
  const totalAmount = orderDetails.amount + orderDetails.platformFeeAmount;
  
  await cUSD.connect(buyer).approve(escrowAddress, totalAmount);
  await escrow.connect(buyer).fundOrder(orderToFund.id);
  console.log(`✅ Funded order #${orderToFund.id}`);

  // Create deployment info
  const deploymentInfo = {
    network: "localhost",
    timestamp: new Date().toISOString(),
    contracts: {
      TransAgriEscrow: escrowAddress,
      MockcUSD: cUSDAddress
    },
    accounts: {
      deployer: deployer.address,
      buyer: buyer.address,
      farmer: farmer.address,
      admin: admin.address
    },
    sampleOrders: createdOrders,
    contractInfo: {
      platformFee: (await escrow.platformFee()).toString(),
      totalOrders: (await escrow.getOrderCount()).toString(),
      totalPlatformFees: ethers.formatEther(await escrow.totalPlatformFees())
    }
  };

  // Save deployment info to file
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }
  
  const deploymentFile = path.join(deploymentsDir, "localhost.json");
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("\n📄 Deployment info saved to:", deploymentFile);

  // Create interaction script with actual addresses
  const interactScript = `
// Auto-generated interaction script for deployed contracts
const { ethers } = require("hardhat");

const ESCROW_ADDRESS = "${escrowAddress}";
const CUSD_ADDRESS = "${cUSDAddress}";

async function quickTest() {
  const [owner, buyer, farmer] = await ethers.getSigners();
  const escrow = await ethers.getContractAt("TransAgriEscrow", ESCROW_ADDRESS);
  const cUSD = await ethers.getContractAt("MockERC20", CUSD_ADDRESS);
  
  console.log("Quick contract test:");
  console.log("Total orders:", (await escrow.getOrderCount()).toString());
  console.log("Buyer cUSD balance:", ethers.formatEther(await cUSD.balanceOf(buyer.address)));
  console.log("Farmer cUSD balance:", ethers.formatEther(await cUSD.balanceOf(farmer.address)));
  console.log("Platform fees:", ethers.formatEther(await escrow.totalPlatformFees()));
}

if (require.main === module) {
  quickTest().catch(console.error);
}

module.exports = { ESCROW_ADDRESS, CUSD_ADDRESS, quickTest };
`;

  fs.writeFileSync(
    path.join(__dirname, "quick-test.js"), 
    interactScript
  );

  // Display summary
  console.log("\n🎉 Setup Complete! Summary:");
  console.log("=====================================");
  console.log("📍 Contracts Deployed:");
  console.log(`   TransAgriEscrow: ${escrowAddress}`);
  console.log(`   Mock cUSD: ${cUSDAddress}`);
  console.log("\n👥 Test Accounts (with 50k cUSD each):");
  console.log(`   Buyer: ${buyer.address}`);
  console.log(`   Farmer: ${farmer.address}`);
  console.log(`   Admin: ${admin.address}`);
  console.log("\n📋 Sample Orders Created:");
  createdOrders.forEach(order => {
    console.log(`   Order #${order.id}: ${order.description} (${ethers.formatEther(order.amount)} cUSD)`);
  });
  console.log("\n🛠️  Next Steps:");
  console.log("   1. Run tests: npx hardhat test");
  console.log("   2. Quick test: npx hardhat run scripts/quick-test.js");
  console.log("   3. Full interaction: npx hardhat run scripts/interact.js");
  console.log("   4. Check deployments/localhost.json for full details");

  return deploymentInfo;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Setup failed:", error);
      process.exit(1);
    });
}

module.exports = main;
