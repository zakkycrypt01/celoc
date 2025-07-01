const { run, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log(`🔍 Starting contract verification on ${network.name}...\n`);

  // Load deployment info
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFile = path.join(deploymentsDir, `${network.name}.json`);
  
  if (!fs.existsSync(deploymentFile)) {
    console.error("❌ No deployment file found for network:", network.name);
    console.log("Available deployment files:");
    const files = fs.readdirSync(deploymentsDir).filter(f => f.endsWith('.json'));
    files.forEach(file => console.log(`  - ${file}`));
    return;
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  console.log("📋 Loaded deployment info:");
  console.log("Network:", deployment.network);
  console.log("Contracts:", deployment.contracts);

  // Skip verification for local networks
  if (network.name === "localhost" || network.name === "hardhat") {
    console.log("⏭️  Skipping verification for local network");
    return;
  }

  try {
    // Verify TransAgriEscrow contract
    const escrowAddress = deployment.contracts.TransAgriEscrow;
    const cUSDAddress = deployment.contracts.cUSD || deployment.contracts.MockcUSD;
    
    if (!escrowAddress || !cUSDAddress) {
      throw new Error("Missing contract addresses in deployment file");
    }

    console.log(`🔍 Verifying TransAgriEscrow at ${escrowAddress}...`);
    
    await run("verify:verify", {
      address: escrowAddress,
      constructorArguments: [cUSDAddress],
      contract: "contracts/TransAgriEscrow.sol:TransAgriEscrow"
    });
    
    console.log("✅ TransAgriEscrow verified successfully!");

    // If we deployed a mock cUSD (for testnets), verify it too
    if (deployment.contracts.MockcUSD && network.name !== "celo") {
      console.log(`🔍 Verifying Mock cUSD at ${cUSDAddress}...`);
      
      try {
        await run("verify:verify", {
          address: cUSDAddress,
          constructorArguments: [
            "Celo Dollar",
            "cUSD", 
            "1000000000000000000000000000" // 1B tokens with 18 decimals
          ],
          contract: "contracts/MockERC20.sol:MockERC20"
        });
        console.log("✅ Mock cUSD verified successfully!");
      } catch (error) {
        console.log("⚠️  Mock cUSD verification failed (might already be verified):", error.message);
      }
    }

    // Update deployment file with verification status
    deployment.verification = {
      verified: true,
      verifiedAt: new Date().toISOString(),
      network: network.name,
      explorer: getExplorerUrl(network.name)
    };

    fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
    console.log("📄 Updated deployment file with verification status");

    // Display explorer links
    console.log("\n🌐 View contracts on block explorer:");
    console.log(`TransAgriEscrow: ${getExplorerUrl(network.name)}/address/${escrowAddress}`);
    if (deployment.contracts.MockcUSD) {
      console.log(`Mock cUSD: ${getExplorerUrl(network.name)}/address/${cUSDAddress}`);
    }

  } catch (error) {
    console.error("❌ Verification failed:", error.message);
    
    if (error.message.includes("Already Verified")) {
      console.log("✅ Contract was already verified!");
    } else if (error.message.includes("API")) {
      console.log("💡 Check your CELOSCAN_API_KEY in .env file");
    } else {
      console.log("💡 Make sure the contract is deployed and the constructor arguments are correct");
    }
  }
}

function getExplorerUrl(networkName) {
  switch (networkName) {
    case "alfajores":
      return "https://alfajores.celoscan.io";
    case "celo":
      return "https://celoscan.io";
    default:
      return "https://etherscan.io"; // fallback
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
