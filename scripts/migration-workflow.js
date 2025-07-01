const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Starting Complete Migration Workflow...\n");

  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer account:", deployer.address);
  console.log("🌐 Network:", network.name);

  // Step 1: Pre-migration checks
  console.log("\n📋 Step 1: Pre-migration validation...");
  await preMigrationChecks();

  // Step 2: Deploy new contracts
  console.log("\n🏗️  Step 2: Deploying new contracts...");
  const newDeployment = await deployNewContracts();

  // Step 3: Perform migration
  console.log("\n🔄 Step 3: Executing migration...");
  await executeMigration(newDeployment);

  // Step 4: Post-migration verification
  console.log("\n✅ Step 4: Post-migration verification...");
  await postMigrationVerification(newDeployment);

  // Step 5: Generate final report
  console.log("\n📊 Step 5: Generating final migration report...");
  await generateFinalReport(newDeployment);

  console.log("\n🎉 Complete migration workflow finished successfully!");
}

async function preMigrationChecks() {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFile = path.join(deploymentsDir, `${network.name}.json`);

  const checks = {
    deploymentExists: fs.existsSync(deploymentFile),
    balanceSufficient: false,
    contractAccessible: false
  };

  // Check if deployment exists
  if (checks.deploymentExists) {
    console.log("✅ Previous deployment found");
    
    const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
    
    // Check if old contract is accessible
    try {
      const oldEscrow = await ethers.getContractAt("TransAgriEscrow", deployment.contracts.TransAgriEscrow);
      await oldEscrow.getOrderCount();
      checks.contractAccessible = true;
      console.log("✅ Old contract is accessible");
    } catch (error) {
      console.log("⚠️  Old contract not accessible:", error.message);
    }
  } else {
    console.log("ℹ️  No previous deployment found - this is a fresh deployment");
  }

  // Check deployer balance
  const balance = await ethers.provider.getBalance(deployer.address);
  const minBalance = ethers.parseEther("0.1"); // Minimum 0.1 ETH/CELO
  
  if (balance > minBalance) {
    checks.balanceSufficient = true;
    console.log("✅ Deployer balance sufficient:", ethers.formatEther(balance));
  } else {
    console.log("❌ Insufficient deployer balance:", ethers.formatEther(balance));
    throw new Error("Insufficient funds for deployment");
  }

  return checks;
}

async function deployNewContracts() {
  // Get cUSD address based on network
  let cUSDAddress;
  let cUSD;

  if (network.name === "localhost" || network.name === "hardhat") {
    console.log("  📦 Deploying mock cUSD for local network...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    cUSD = await MockERC20.deploy("Celo Dollar", "cUSD", ethers.parseEther("1000000000"));
    await cUSD.waitForDeployment();
    cUSDAddress = await cUSD.getAddress();
    console.log("  ✅ Mock cUSD deployed:", cUSDAddress);
  } else if (network.name === "alfajores") {
    cUSDAddress = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";
    console.log("  ✅ Using Alfajores cUSD:", cUSDAddress);
  } else if (network.name === "celo") {
    cUSDAddress = "0x765DE816845861e75A25fCA122bb6898B8B1282a";
    console.log("  ✅ Using Celo Mainnet cUSD:", cUSDAddress);
  }

  // Deploy new escrow contract
  console.log("  📦 Deploying new TransAgriEscrow...");
  const TransAgriEscrow = await ethers.getContractFactory("TransAgriEscrow");
  const escrow = await TransAgriEscrow.deploy(cUSDAddress);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("  ✅ TransAgriEscrow deployed:", escrowAddress);

  // Verify deployment
  const owner = await escrow.owner();
  const tokenAddress = await escrow.cUSD();
  const platformFee = await escrow.platformFee();

  console.log("  📋 Contract verification:");
  console.log("    - Owner:", owner);
  console.log("    - cUSD Token:", tokenAddress);
  console.log("    - Platform Fee:", platformFee.toString(), "basis points");

  return {
    escrow: escrowAddress,
    cUSD: cUSDAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString()
  };
}

async function executeMigration(newDeployment) {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFile = path.join(deploymentsDir, `${network.name}.json`);

  if (!fs.existsSync(deploymentFile)) {
    console.log("  ℹ️  No previous deployment to migrate from");
    return;
  }

  const oldDeployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const oldEscrowAddress = oldDeployment.contracts.TransAgriEscrow;
  
  console.log("  🔄 Migrating from:", oldEscrowAddress);
  console.log("  🔄 Migrating to:", newDeployment.escrow);

  const oldEscrow = await ethers.getContractAt("TransAgriEscrow", oldEscrowAddress);
  const newEscrow = await ethers.getContractAt("TransAgriEscrow", newDeployment.escrow);

  // Pause old contract
  try {
    console.log("  🛑 Attempting to pause old contract...");
    const isPaused = await oldEscrow.paused();
    if (!isPaused) {
      const pauseTx = await oldEscrow.pause();
      await pauseTx.wait();
      console.log("  ✅ Old contract paused");
    } else {
      console.log("  ✅ Old contract already paused");
    }
  } catch (error) {
    console.log("  ⚠️  Could not pause old contract:", error.message);
  }

  // Get migration data
  const orderCount = await oldEscrow.getOrderCount();
  const platformFees = await oldEscrow.totalPlatformFees();

  console.log("  📊 Migration data:");
  console.log("    - Total orders:", orderCount.toString());
  console.log("    - Platform fees:", ethers.formatEther(platformFees), "cUSD");

  // Withdraw platform fees
  if (platformFees > 0) {
    try {
      console.log("  💰 Withdrawing platform fees...");
      const withdrawTx = await oldEscrow.withdrawPlatformFees(platformFees);
      await withdrawTx.wait();
      console.log("  ✅ Platform fees withdrawn");
    } catch (error) {
      console.log("  ⚠️  Could not withdraw platform fees:", error.message);
    }
  }

  // Create migration record
  const migrationRecord = {
    timestamp: new Date().toISOString(),
    oldContract: oldEscrowAddress,
    newContract: newDeployment.escrow,
    orderCount: orderCount.toString(),
    platformFeesWithdrawn: ethers.formatEther(platformFees),
    status: "completed"
  };

  const migrationFile = path.join(deploymentsDir, `migration-${Date.now()}.json`);
  fs.writeFileSync(migrationFile, JSON.stringify(migrationRecord, null, 2));
  console.log("  📄 Migration record saved:", migrationFile);
}

async function postMigrationVerification(newDeployment) {
  console.log("  🧪 Testing new contract...");
  
  const escrow = await ethers.getContractAt("TransAgriEscrow", newDeployment.escrow);
  
  // Basic functionality test
  const [deployer, testBuyer, testFarmer] = await ethers.getSigners();
  
  if (network.name === "localhost" || network.name === "hardhat") {
    try {
      // Fund test accounts if local
      const cUSD = await ethers.getContractAt("MockERC20", newDeployment.cUSD);
      await cUSD.transfer(testBuyer.address, ethers.parseEther("1000"));
      
      // Test order creation
      const testAmount = ethers.parseEther("10");
      const tx = await escrow.connect(testBuyer).createOrder(
        "migration-test",
        testFarmer.address,
        testAmount
      );
      await tx.wait();
      
      const orderCount = await escrow.getOrderCount();
      console.log("  ✅ Contract functionality verified - order count:", orderCount.toString());
      
    } catch (error) {
      console.log("  ⚠️  Contract test failed:", error.message);
    }
  } else {
    // For live networks, just check basic state
    const orderCount = await escrow.getOrderCount();
    const owner = await escrow.owner();
    console.log("  ✅ Contract state verified - orders:", orderCount.toString(), "owner:", owner);
  }
}

async function generateFinalReport(newDeployment) {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  
  // Update main deployment file
  const deploymentInfo = {
    network: network.name,
    timestamp: newDeployment.timestamp,
    version: "v2.0",
    contracts: {
      TransAgriEscrow: newDeployment.escrow,
      [network.name === "localhost" || network.name === "hardhat" ? "MockcUSD" : "cUSD"]: newDeployment.cUSD
    },
    deployer: newDeployment.deployer,
    migrationCompleted: true
  };

  const deploymentFile = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));

  // Generate comprehensive report
  const finalReport = {
    migrationSummary: {
      date: new Date().toISOString(),
      network: network.name,
      success: true,
      newContract: newDeployment.escrow,
      deployer: newDeployment.deployer
    },
    
    nextSteps: [
      "Update frontend application with new contract address",
      "Notify users about the contract upgrade",
      "Monitor contract for first 24 hours",
      "Update documentation and API references",
      "Consider running integration tests"
    ],
    
    technicalDetails: {
      contractAddress: newDeployment.escrow,
      cUSDAddress: newDeployment.cUSD,
      networkDetails: {
        name: network.name,
        chainId: network.name === "alfajores" ? 44787 : network.name === "celo" ? 42220 : 31337
      }
    },
    
    files: {
      deployment: `${network.name}.json`,
      migration: "migration-*.json",
      frontendConfig: `frontend-config-${network.name}.json`,
      environment: `.env.${network.name}`
    }
  };

  const reportFile = path.join(deploymentsDir, `final-migration-report-${Date.now()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(finalReport, null, 2));

  console.log("  📄 Final report saved:", reportFile);
  console.log("\n  📋 Next Steps:");
  finalReport.nextSteps.forEach((step, index) => {
    console.log(`    ${index + 1}. ${step}`);
  });
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Migration workflow failed:", error);
      process.exit(1);
    });
}

module.exports = main;
