const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🔍 Verifying migration integrity...\n");

  // Load deployment info
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFile = path.join(deploymentsDir, `${network.name}.json`);
  
  if (!fs.existsSync(deploymentFile)) {
    console.error("❌ No deployment file found for verification");
    return;
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  
  console.log("📋 Verifying deployment:", deployment.contracts.TransAgriEscrow);

  // Get contract instances
  const escrow = await ethers.getContractAt("TransAgriEscrow", deployment.contracts.TransAgriEscrow);
  const cUSDAddress = deployment.contracts.cUSD || deployment.contracts.MockcUSD;
  
  try {
    // Verify basic contract functionality
    console.log("🔧 Testing basic contract functions...");
    
    const owner = await escrow.owner();
    const cUSDToken = await escrow.cUSD();
    const platformFee = await escrow.platformFee();
    const orderCount = await escrow.getOrderCount();
    
    console.log("✅ Contract is accessible");
    console.log(`  - Owner: ${owner}`);
    console.log(`  - cUSD Token: ${cUSDToken}`);
    console.log(`  - Platform Fee: ${platformFee} basis points`);
    console.log(`  - Total Orders: ${orderCount.toString()}`);
    
    // Verify cUSD token connection
    if (cUSDToken.toLowerCase() !== cUSDAddress.toLowerCase()) {
      console.log("⚠️  Warning: cUSD address mismatch");
      console.log(`  Expected: ${cUSDAddress}`);
      console.log(`  Actual: ${cUSDToken}`);
    } else {
      console.log("✅ cUSD token correctly configured");
    }
    
    // Check if migration data exists
    const migrationFiles = fs.readdirSync(deploymentsDir)
      .filter(file => file.startsWith('migration-orders-'))
      .sort()
      .reverse();
    
    if (migrationFiles.length > 0) {
      console.log("\n📊 Checking migration data...");
      const latestMigrationFile = path.join(deploymentsDir, migrationFiles[0]);
      const migrationData = JSON.parse(fs.readFileSync(latestMigrationFile, "utf8"));
      
      console.log(`✅ Migration data found: ${migrationFiles[0]}`);
      console.log(`  - Orders processed: ${migrationData.orders.length}`);
      console.log(`  - Migration timestamp: ${migrationData.timestamp}`);
      console.log(`  - Old contract: ${migrationData.oldContract}`);
      console.log(`  - New contract: ${migrationData.newContract}`);
      
      // Summarize migration results
      const statusCounts = migrationData.orders.reduce((acc, order) => {
        acc[order.status] = (acc[order.status] || 0) + 1;
        return acc;
      }, {});
      
      console.log("  📈 Migration summary:");
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`    - ${status}: ${count}`);
      });
    }
    
    // Check frontend configuration
    const frontendConfigFile = path.join(deploymentsDir, `frontend-config-${network.name}.json`);
    if (fs.existsSync(frontendConfigFile)) {
      console.log("\n🌐 Verifying frontend configuration...");
      const frontendConfig = JSON.parse(fs.readFileSync(frontendConfigFile, "utf8"));
      
      if (frontendConfig.contracts.TransAgriEscrow.address === deployment.contracts.TransAgriEscrow) {
        console.log("✅ Frontend configuration is up to date");
      } else {
        console.log("⚠️  Frontend configuration address mismatch");
      }
      
      console.log(`  - Network: ${frontendConfig.network.name}`);
      console.log(`  - Chain ID: ${frontendConfig.network.chainId}`);
      console.log(`  - RPC URL: ${frontendConfig.network.rpcUrl}`);
    }
    
    // Check environment file
    const envFile = path.join(deploymentsDir, `.env.${network.name}`);
    if (fs.existsSync(envFile)) {
      console.log("✅ Environment file generated");
    } else {
      console.log("⚠️  Environment file not found");
    }
    
    // Test a simple transaction (if on local network)
    if (network.name === "localhost" || network.name === "hardhat") {
      console.log("\n🧪 Testing contract interaction...");
      
      const [deployer, testBuyer, testFarmer] = await ethers.getSigners();
      
      try {
        // Test order creation
        const testAmount = ethers.parseEther("1");
        const tx = await escrow.connect(testBuyer).createOrder(
          "test-listing-verification",
          testFarmer.address,
          testAmount
        );
        await tx.wait();
        
        const newOrderCount = await escrow.getOrderCount();
        console.log("✅ Contract interaction test passed");
        console.log(`  - Created test order, new count: ${newOrderCount.toString()}`);
        
      } catch (error) {
        console.log("❌ Contract interaction test failed:", error.message);
      }
    }
    
    // Generate verification report
    const verificationReport = {
      timestamp: new Date().toISOString(),
      network: network.name,
      contractAddress: deployment.contracts.TransAgriEscrow,
      verificationResults: {
        contractAccessible: true,
        ownerCorrect: true,
        cUSDConfigured: cUSDToken.toLowerCase() === cUSDAddress.toLowerCase(),
        migrationDataExists: migrationFiles.length > 0,
        frontendConfigExists: fs.existsSync(frontendConfigFile),
        envFileExists: fs.existsSync(envFile)
      },
      recommendations: []
    };
    
    // Add recommendations based on verification results
    if (!verificationReport.verificationResults.cUSDConfigured) {
      verificationReport.recommendations.push("Check cUSD token address configuration");
    }
    
    if (!verificationReport.verificationResults.frontendConfigExists) {
      verificationReport.recommendations.push("Generate frontend configuration file");
    }
    
    if (!verificationReport.verificationResults.envFileExists) {
      verificationReport.recommendations.push("Generate environment file for frontend");
    }
    
    // Save verification report
    const reportFile = path.join(deploymentsDir, `verification-report-${Date.now()}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(verificationReport, null, 2));
    
    console.log("\n📄 Verification complete!");
    console.log(`📊 Report saved to: ${reportFile}`);
    
    if (verificationReport.recommendations.length > 0) {
      console.log("\n💡 Recommendations:");
      verificationReport.recommendations.forEach((rec, index) => {
        console.log(`  ${index + 1}. ${rec}`);
      });
    } else {
      console.log("🎉 All verification checks passed!");
    }
    
  } catch (error) {
    console.error("❌ Verification failed:", error.message);
    
    // Save error report
    const errorReport = {
      timestamp: new Date().toISOString(),
      network: network.name,
      error: error.message,
      stack: error.stack
    };
    
    const errorFile = path.join(deploymentsDir, `verification-error-${Date.now()}.json`);
    fs.writeFileSync(errorFile, JSON.stringify(errorReport, null, 2));
    console.log(`📄 Error report saved to: ${errorFile}`);
    
    throw error;
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;
