# TransAgri Escrow Smart Contract

A comprehensive escrow system for agricultural transactions on the Celo blockchain network, enabling secure trade between farmers and buyers with built-in dispute resolution.

## Features

- **Secure Escrow**: Funds are held safely until delivery confirmation
- **Multi-stage Process**: Order creation, funding, shipping, delivery, and completion
- **Dispute Resolution**: Built-in dispute mechanism with admin resolution
- **Auto-release**: Automatic fund release after delivery deadline
- **Platform Fees**: Configurable platform fee system
- **Pause Functionality**: Emergency pause capability
- **Celo Integration**: Native support for cUSD payments

## Contract Architecture

### Core Components

- **TransAgriEscrow.sol**: Main escrow contract
- **MockERC20.sol**: Test token for local development

### Order States

1. **Created**: Order initiated but not funded
2. **Funded**: Buyer has deposited funds
3. **Shipped**: Farmer marked order as shipped
4. **Delivered**: Buyer confirmed delivery
5. **Disputed**: Dispute initiated by either party
6. **Completed**: Order successfully completed
7. **Cancelled**: Order cancelled (only unfunded orders)
8. **Refunded**: Funds returned to buyer after dispute

## Quick Start

### Prerequisites

- Node.js >= 16.0.0
- npm or yarn
- Git

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd transagri-escrow

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration (for testnet/mainnet deployment)
```

### Local Development

```bash
# Compile contracts
npm run compile

# Run tests
npm run test

# Run tests with gas reporting
npm run test:gas

# Setup local environment with sample data
npm run setup

# Start local Hardhat node (in separate terminal)
npm run node

# Deploy to local network
npm run deploy:local
```

### Testing

```bash
# Run all tests
npm run test

# Run tests with verbose output
npm run test:verbose

# Run tests with gas reporting
npm run test:gas

# Generate coverage report
npm run coverage

# Quick interaction test
npm run quick-test
```

## Deployment

### Local Deployment

```bash
# Start local node
npm run node

# In another terminal, deploy contracts
npm run setup
```

### Testnet Deployment (Celo Alfajores)

```bash
# Set up your .env file with private key
PRIVATE_KEY=your_private_key_without_0x
CELOSCAN_API_KEY=your_celoscan_api_key

# Deploy to Alfajores testnet
npm run deploy:alfajores

# Verify contracts
npm run verify:alfajores
```

### Mainnet Deployment (Celo)

```bash
# Deploy to Celo mainnet
npm run deploy:celo

# Verify contracts
npm run verify:celo
```

## Available Scripts

- `npm run compile` - Compile smart contracts
- `npm run test` - Run test suite
- `npm run deploy:local` - Deploy to local network
- `npm run deploy:alfajores` - Deploy to Alfajores testnet
- `npm run deploy:celo` - Deploy to Celo mainnet
- `npm run setup` - Setup local environment with test data
- `npm run verify:alfajores` - Verify contracts on Alfajores
- `npm run verify:celo` - Verify contracts on Celo mainnet
- `npm run interact` - Run interaction demo
- `npm run migrate:*` - Migrate/upgrade contracts
- `npm run node` - Start local Hardhat node

## Security Features

- **ReentrancyGuard**: Protection against reentrancy attacks
- **Pausable**: Emergency stop functionality
- **Ownable**: Admin access control
- **Input Validation**: Comprehensive parameter validation
- **Safe Math**: Built-in overflow protection (Solidity 0.8+)

## Testing

### Test Coverage

- ✅ Contract deployment
- ✅ Order creation and validation
- ✅ Order funding and escrow
- ✅ Shipping and delivery confirmation
- ✅ Auto-release functionality
- ✅ Dispute initiation and resolution
- ✅ Order cancellation
- ✅ Platform fee management
- ✅ Pause functionality
- ✅ Access control
- ✅ Edge cases and error conditions

## Network Configurations

### Supported Networks

- **Hardhat/Localhost**: Local development
- **Celo Alfajores**: Testnet
- **Celo Mainnet**: Production

### cUSD Token Addresses

- **Alfajores**: `0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1`
- **Mainnet**: `0x765DE816845861e75A25fCA122bb6898B8B1282a`
