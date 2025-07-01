const { ethers, network } = require("hardhat");

async function main() {
  console.log(`Deploying to network: ${network.name}`);
  
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // cUSD token addresses for different networks
  const cUSDAddresses = {
    // Celo Mainnet
    celo: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
    // Celo Alfajores Testnet
    alfajores: "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1",
    // For local development, we'll deploy a mock token
    localhost: null,
    hardhat: null
  };

  let cUSDAddress;
  let cUSD;

  // Deploy mock cUSD for local development
  if (network.name === "localhost" || network.name === "hardhat") {
    console.log("Deploying mock cUSD token for local development...");
    
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const initialSupply = ethers.parseEther("1000000000"); // 1B tokens
    cUSD = await MockERC20.deploy("Celo Dollar", "cUSD", initialSupply);
    await cUSD.waitForDeployment();
    cUSDAddress = await cUSD.getAddress();
    
    console.log("Mock cUSD deployed to:", cUSDAddress);
  } else {
    // Use real cUSD address for live networks
    cUSDAddress = cUSDAddresses[network.name];
    if (!cUSDAddress) {
      throw new Error(`cUSD address not configured for network: ${network.name}`);
    }
    console.log("Using cUSD token at:", cUSDAddress);
  }

  // Deploy TransAgriEscrow contract
  console.log("Deploying TransAgriEscrow contract...");
  
  const TransAgriEscrow = await ethers.getContractFactory("TransAgriEscrow");
  const escrow = await TransAgriEscrow.deploy(cUSDAddress);
  await escrow.waitForDeployment();
  
  const escrowAddress = await escrow.getAddress();
  console.log("TransAgriEscrow deployed to:", escrowAddress);

  // Verify deployment
  console.log("\nVerifying deployment...");
  const owner = await escrow.owner();
  const tokenAddress = await escrow.cUSD();
  const platformFee = await escrow.platformFee();
  
  console.log("Contract owner:", owner);
  console.log("cUSD token address:", tokenAddress);
  console.log("Platform fee:", platformFee.toString(), "basis points");

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    deployer: deployer.address,
    contracts: {
      TransAgriEscrow: escrowAddress,
      cUSD: cUSDAddress
    },
    deployedAt: new Date().toISOString(),
    blockNumber: await ethers.provider.getBlockNumber()
  };

  console.log("\nDeployment Summary:");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  // For local development, fund some test accounts
  if (network.name === "localhost" || network.name === "hardhat") {
    console.log("\nSetting up test environment...");
    
    const accounts = await ethers.getSigners();
    const testAmount = ethers.parseEther("10000"); // 10k cUSD per account
    
    // Fund first 5 accounts with test cUSD
    for (let i = 1; i < Math.min(6, accounts.length); i++) {
      await cUSD.transfer(accounts[i].address, testAmount);
      console.log(`Funded ${accounts[i].address} with ${ethers.formatEther(testAmount)} cUSD`);
    }
  }

  // Contract verification instructions
  if (network.name !== "localhost" && network.name !== "hardhat") {
    console.log("\nTo verify the contract on block explorer, run:");
    console.log(`npx hardhat verify --network ${network.name} ${escrowAddress} ${cUSDAddress}`);
  }

  return {
    escrow: escrowAddress,
    cUSD: cUSDAddress,
    deployer: deployer.address
  };
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then((result) => {
    console.log("\nDeployment completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });

module.exports = main;
