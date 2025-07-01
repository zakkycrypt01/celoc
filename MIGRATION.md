# TransAgri Escrow Migration Guide

This document provides comprehensive instructions for migrating the TransAgri Escrow smart contract to a new version.

## Overview

The migration system provides a complete solution for upgrading the TransAgri Escrow contract while preserving user data and ensuring minimal downtime. It includes:

1. **Automated Migration** - Scripts that handle the complete migration process
2. **Data Preservation** - Ensures no loss of orders or platform fees
3. **Rollback Capability** - Safe rollback in case of issues
4. **Frontend Integration** - Automatic generation of frontend configuration files

## Migration Scripts

### Core Migration Scripts

- `migrate.js` - Basic migration with manual steps documented
- `migration-workflow.js` - Complete automated migration workflow  
- `verify-migration.js` - Post-migration verification
- `rollback.js` - Emergency rollback functionality

### Support Scripts

- `deploy.js` - Standard deployment for new networks
- `setup.js` - Local development environment setup
- `verify.js` - Contract verification on block explorers

## Migration Process

### 1. Pre-Migration Preparation

Before starting migration, ensure:

```bash
# 1. Run tests to ensure code quality
npm run test

# 2. Compile contracts
npm run compile

# 3. Check deployer balance (minimum 0.1 ETH/CELO)
# 4. Backup current deployment files
cp deployments/[network].json deployments/[network].backup.$(date +%s).json
```

### 2. Execute Migration Workflow

For a complete automated migration:

```bash
# Local development
npm run migrate:workflow:local

# Alfajores testnet
npm run migrate:workflow:alfajores

# Celo mainnet
npm run migrate:workflow:celo
```

### 3. Verify Migration

After migration, verify everything is working:

```bash
# Verify migration integrity
npm run migrate:verify:local  # or :alfajores/:celo

# Test contract interaction
npm run interact
```

### 4. Update Frontend

The migration automatically generates:

- `frontend-config-[network].json` - Complete frontend configuration
- `.env.[network]` - Environment variables for frontend
- `user-notification-[network].json` - User notification template

## Manual Migration Steps

If you prefer step-by-step manual control:

### Step 1: Deploy New Contract

```bash
# Deploy new version
npm run deploy:local  # or :alfajores/:celo
```

### Step 2: Execute Specific Migration

```bash
# Run enhanced migration with data transfer
npm run migrate:local  # or :alfajores/:celo
```

### Step 3: Verify and Update

```bash
# Verify migration
npm run migrate:verify:local

# Update frontend with generated config files
```

## Migration Features

### 1. Contract Pausing

The migration automatically pauses the old contract to prevent new transactions:

```javascript
// Automatically executed during migration
await oldEscrow.pause();
```

### 2. Order Migration

Active orders are analyzed and categorized:

- **Completed Orders**: No action needed
- **Active Orders**: Migration data recorded for manual handling
- **Disputed Orders**: Flagged for manual intervention

### 3. Platform Fee Transfer

Platform fees are automatically withdrawn from the old contract:

```javascript
// Automatically executed if fees exist
await oldEscrow.withdrawPlatformFees(totalFees);
```

### 4. Frontend Configuration Generation

Automatic generation of frontend integration files:

**frontend-config-[network].json**:
```json
{
  "contracts": {
    "TransAgriEscrow": {
      "address": "0x...",
      "network": "alfajores"
    }
  },
  "migration": {
    "previousContract": "0x...",
    "migrationDate": "2025-07-01T..."
  }
}
```

**Environment Variables**:
```bash
REACT_APP_ESCROW_ADDRESS=0x...
REACT_APP_CUSD_ADDRESS=0x...
REACT_APP_NETWORK=alfajores
```

## Rollback Process

If migration fails or issues are discovered:

### 1. List Available Backups

```bash
npm run rollback:list
```

### 2. Execute Rollback

```bash
# Rollback to previous version
npm run rollback:local  # or :alfajores/:celo
```

### 3. Verify Rollback

The rollback script automatically:
- Restores previous deployment configuration
- Updates frontend config files
- Unpauses the old contract if needed
- Generates rollback report

## Network-Specific Considerations

### Localhost/Hardhat

- Uses mock cUSD token
- Includes test account funding
- Full testing capability

### Alfajores Testnet

- Uses real Alfajores cUSD: `0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1`
- Contract verification on Celoscan
- Requires testnet CELO for gas

### Celo Mainnet

- Uses mainnet cUSD: `0x765DE816845861e75A25fCA122bb6898B8B1282a`
- Production deployment
- Requires mainnet CELO for gas
- Additional verification steps recommended

## File Structure After Migration

```
deployments/
├── [network].json                     # Current deployment
├── [network].backup.[timestamp].json  # Backup of previous deployment
├── migration-[timestamp].json         # Migration record
├── migration-orders-[timestamp].json  # Order migration data
├── frontend-config-[network].json     # Frontend configuration
├── .env.[network]                     # Environment variables
├── verification-report-[timestamp].json # Verification results
└── user-notification-[network].json   # User notification template
```

## Troubleshooting

### Common Issues

1. **Insufficient Gas**
   - Ensure deployer account has adequate balance
   - Consider increasing gas limits in hardhat.config.js

2. **Contract Not Paused**
   - Check if deployer is contract owner
   - Manually pause using contract owner account

3. **Platform Fee Withdrawal Failed**
   - Verify sufficient fees exist
   - Check owner permissions

4. **Verification Failed**
   - Ensure CELOSCAN_API_KEY is set
   - Check network configuration

### Recovery Steps

If migration fails:

1. Check error logs in deployments folder
2. Use rollback script to restore previous state
3. Investigate issue and retry
4. Contact support if needed

## Security Considerations

1. **Owner Account**: Ensure migration is executed by contract owner
2. **Backup Creation**: Always create backups before migration
3. **Verification**: Always run post-migration verification
4. **Monitoring**: Monitor contract for 24 hours after migration
5. **User Communication**: Notify users about contract updates

## Testing Migration

For testing migration process:

```bash
# 1. Start local network
npm run node

# 2. Setup test environment with sample data
npm run setup

# 3. Test migration workflow
npm run migrate:workflow:local

# 4. Verify migration
npm run migrate:verify:local

# 5. Test rollback if needed
npm run rollback:local
```

## Advanced Usage

### Custom Migration

For custom migration requirements, modify `migration-workflow.js`:

```javascript
// Add custom migration logic
async function customMigrationSteps(oldEscrow, newEscrow) {
  // Your custom migration code here
}
```

### Integration with CI/CD

Add migration to deployment pipeline:

```yaml
# Example GitHub Actions
- name: Deploy and Migrate
  run: |
    npm run migrate:workflow:alfajores
    npm run migrate:verify:alfajores
```

## Support

For technical support or questions about migration:

1. Check this documentation
2. Review error logs in deployments folder
3. Test on local network first
4. Create GitHub issue with details

---

**⚠️ Important**: Always test migration on local network or testnet before executing on mainnet.
