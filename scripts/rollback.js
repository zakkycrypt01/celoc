const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🔄 Starting Migration Rollback Process...\n");

  const [deployer] = await ethers.getSigners();
  console.log("👤 Rollback executor:", deployer.address);
  console.log("🌐 Network:", network.name);

  // Step 1: Find backup deployment
  console.log("\n📋 Step 1: Locating backup deployment...");
  const backupDeployment = await findBackupDeployment();

  // Step 2: Verify rollback is safe
  console.log("\n🔍 Step 2: Verifying rollback safety...");
  await verifyRollbackSafety(backupDeployment);

  // Step 3: Execute rollback
  console.log("\n⏪ Step 3: Executing rollback...");
  await executeRollback(backupDeployment);

  // Step 4: Verify rollback success
  console.log("\n✅ Step 4: Verifying rollback success...");
  await verifyRollbackSuccess(backupDeployment);

  console.log("\n🎉 Rollback completed successfully!");
}

async function findBackupDeployment() {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  
  // Find backup files
  const backupFiles = fs.readdirSync(deploymentsDir)
    .filter(file => file.includes('.backup.') && file.endsWith('.json'))
    .sort()
    .reverse(); // Most recent first

  if (backupFiles.length === 0) {
    throw new Error("No backup deployment files found");
  }

  console.log("  📁 Available backup files:");
  backupFiles.forEach((file, index) => {
    console.log(`    ${index + 1}. ${file}`);
  });

  // Use the most recent backup
  const latestBackup = backupFiles[0];
  const backupPath = path.join(deploymentsDir, latestBackup);
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));

  console.log(`  ✅ Using backup: ${latestBackup}`);
  console.log(`  📅 Backup date: ${backup.timestamp || 'Unknown'}`);
  console.log(`  📍 Contract: ${backup.contracts.TransAgriEscrow}`);

  return {
    file: latestBackup,
    path: backupPath,
    data: backup
  };
}

async function verifyRollbackSafety(backup) {
  const currentDeploymentFile = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  
  if (!fs.existsSync(currentDeploymentFile)) {
    console.log("  ℹ️  No current deployment found - rollback may not be necessary");
    return;
  }

  const currentDeployment = JSON.parse(fs.readFileSync(currentDeploymentFile, "utf8"));
  
  console.log("  🔍 Checking rollback safety...");
  console.log(`    Current contract: ${currentDeployment.contracts.TransAgriEscrow}`);
  console.log(`    Backup contract: ${backup.data.contracts.TransAgriEscrow}`);

  // Check if backup contract is still accessible
  try {
    const backupEscrow = await ethers.getContractAt("TransAgriEscrow", backup.data.contracts.TransAgriEscrow);
    const orderCount = await backupEscrow.getOrderCount();
    const isPaused = await backupEscrow.paused();
    
    console.log("  ✅ Backup contract is accessible");
    console.log(`    - Order count: ${orderCount.toString()}`);
    console.log(`    - Is paused: ${isPaused}`);

    if (isPaused) {
      console.log("  ⚠️  Warning: Backup contract is paused");
      console.log("    You may need to unpause it after rollback");
    }

  } catch (error) {
    console.log("  ❌ Backup contract is not accessible:", error.message);
    throw new Error("Rollback not safe - backup contract is not accessible");
  }

  // Check for migration data that might be lost
  const deploymentsDir = path.dirname(currentDeploymentFile);
  const migrationFiles = fs.readdirSync(deploymentsDir)
    .filter(file => file.startsWith('migration-') && file.endsWith('.json'));

  if (migrationFiles.length > 0) {
    console.log("  ⚠️  Warning: Migration data exists that will be preserved:");
    migrationFiles.forEach(file => {
      console.log(`    - ${file}`);
    });
  }
}

async function executeRollback(backup) {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const currentDeploymentFile = path.join(deploymentsDir, `${network.name}.json`);
  
  // Create rollback backup of current state
  if (fs.existsSync(currentDeploymentFile)) {
    const rollbackBackupFile = path.join(deploymentsDir, `${network.name}.rollback.${Date.now()}.json`);
    fs.copyFileSync(currentDeploymentFile, rollbackBackupFile);
    console.log(`  💾 Current state backed up to: ${rollbackBackupFile}`);
  }

  // Restore backup deployment
  const restoredDeployment = {
    ...backup.data,
    rollback: {
      timestamp: new Date().toISOString(),
      restoredFrom: backup.file,
      executor: deployer.address,
      reason: "Migration rollback"
    }
  };

  fs.writeFileSync(currentDeploymentFile, JSON.stringify(restoredDeployment, null, 2));
  console.log(`  ✅ Deployment restored to: ${currentDeploymentFile}`);

  // If the backup contract is paused, attempt to unpause it
  if (backup.data.contracts.TransAgriEscrow) {
    try {
      const escrow = await ethers.getContractAt("TransAgriEscrow", backup.data.contracts.TransAgriEscrow);
      const isPaused = await escrow.paused();
      
      if (isPaused) {
        console.log("  🔓 Attempting to unpause backup contract...");
        const unpauseTx = await escrow.unpause();
        await unpauseTx.wait();
        console.log("  ✅ Contract unpaused successfully");
      }
    } catch (error) {
      console.log("  ⚠️  Could not unpause contract:", error.message);
      console.log("    You may need to manually unpause the contract");
    }
  }

  // Update frontend configuration to point back to backup
  const frontendConfigFile = path.join(deploymentsDir, `frontend-config-${network.name}.json`);
  if (fs.existsSync(frontendConfigFile)) {
    const frontendConfig = JSON.parse(fs.readFileSync(frontendConfigFile, "utf8"));
    
    // Update contract address
    frontendConfig.contracts.TransAgriEscrow.address = backup.data.contracts.TransAgriEscrow;
    frontendConfig.rollback = {
      timestamp: new Date().toISOString(),
      previousAddress: frontendConfig.contracts.TransAgriEscrow.address,
      reason: "Migration rollback"
    };

    fs.writeFileSync(frontendConfigFile, JSON.stringify(frontendConfig, null, 2));
    console.log("  ✅ Frontend configuration updated");
  }

  // Update environment file
  const envFile = path.join(deploymentsDir, `.env.${network.name}`);
  if (fs.existsSync(envFile)) {
    let envContent = fs.readFileSync(envFile, "utf8");
    
    // Update contract address in env file
    envContent = envContent.replace(
      /REACT_APP_ESCROW_ADDRESS=.*/,
      `REACT_APP_ESCROW_ADDRESS=${backup.data.contracts.TransAgriEscrow}`
    );
    
    // Add rollback timestamp
    envContent += `\n\n# Rollback Information\nREACT_APP_ROLLBACK_DATE=${new Date().toISOString()}\n`;
    
    fs.writeFileSync(envFile, envContent);
    console.log("  ✅ Environment file updated");
  }

  // Create rollback report
  const rollbackReport = {
    timestamp: new Date().toISOString(),
    network: network.name,
    executor: deployer.address,
    
    rollbackDetails: {
      restoredContract: backup.data.contracts.TransAgriEscrow,
      restoredFrom: backup.file,
      backupTimestamp: backup.data.timestamp
    },
    
    actions: [
      "Deployment file restored from backup",
      "Frontend configuration updated", 
      "Environment file updated",
      isPaused ? "Contract unpause attempted" : "Contract was not paused"
    ],
    
    nextSteps: [
      "Verify frontend application works with restored contract",
      "Notify users that rollback has been completed",
      "Monitor contract for proper functionality",
      "Consider investigating why rollback was necessary"
    ]
  };

  const rollbackReportFile = path.join(deploymentsDir, `rollback-report-${Date.now()}.json`);
  fs.writeFileSync(rollbackReportFile, JSON.stringify(rollbackReport, null, 2));
  console.log(`  📄 Rollback report saved: ${rollbackReportFile}`);
}

async function verifyRollbackSuccess(backup) {
  console.log("  🧪 Testing restored contract...");
  
  const escrow = await ethers.getContractAt("TransAgriEscrow", backup.data.contracts.TransAgriEscrow);
  
  try {
    // Basic connectivity test
    const owner = await escrow.owner();
    const orderCount = await escrow.getOrderCount();
    const isPaused = await escrow.paused();
    
    console.log("  ✅ Contract connectivity verified");
    console.log(`    - Owner: ${owner}`);
    console.log(`    - Order count: ${orderCount.toString()}`);
    console.log(`    - Is paused: ${isPaused}`);

    // Test basic functionality if not paused
    if (!isPaused && (network.name === "localhost" || network.name === "hardhat")) {
      const [deployer, testBuyer, testFarmer] = await ethers.getSigners();
      
      try {
        // Try to create a test order
        const testAmount = ethers.parseEther("1");
        const tx = await escrow.connect(testBuyer).createOrder(
          "rollback-test",
          testFarmer.address, 
          testAmount
        );
        await tx.wait();
        
        console.log("  ✅ Contract functionality test passed");
      } catch (error) {
        console.log("  ⚠️  Contract functionality test failed:", error.message);
      }
    }

    console.log("  🎉 Rollback verification completed successfully");
    
  } catch (error) {
    console.log("  ❌ Rollback verification failed:", error.message);
    throw new Error("Rollback verification failed - contract may not be functioning properly");
  }
}

// Utility function to list available backups
async function listBackups() {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const backupFiles = fs.readdirSync(deploymentsDir)
    .filter(file => file.includes('.backup.') && file.endsWith('.json'))
    .sort()
    .reverse();

  console.log("📁 Available backup files:");
  if (backupFiles.length === 0) {
    console.log("  No backup files found");
  } else {
    backupFiles.forEach((file, index) => {
      const backupPath = path.join(deploymentsDir, file);
      const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
      console.log(`  ${index + 1}. ${file}`);
      console.log(`     Contract: ${backup.contracts?.TransAgriEscrow || 'Unknown'}`);
      console.log(`     Date: ${backup.timestamp || 'Unknown'}`);
    });
  }
}

// Export functions for use in other scripts
module.exports = {
  main,
  listBackups,
  findBackupDeployment,
  executeRollback
};

if (require.main === module) {
  // Check if user wants to list backups
  if (process.argv.includes('--list')) {
    listBackups()
      .then(() => process.exit(0))
      .catch(console.error);
  } else {
    main()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error("Rollback failed:", error);
        process.exit(1);
      });
  }
}
