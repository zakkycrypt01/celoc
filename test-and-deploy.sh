#!/bin/bash

# TransAgri Escrow - Complete Test and Deployment Summary
# This script demonstrates the full test and deployment process

echo "🚀 TransAgri Escrow - Complete Test & Deployment Summary"
echo "======================================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -f "contracts/TransAgriEscrow.sol" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

echo "📋 Current Project Status:"
echo "- Project: $(cat package.json | grep '"name"' | cut -d'"' -f4)"
echo "- Version: $(cat package.json | grep '"version"' | cut -d'"' -f4)"
echo "- Node.js: $(node --version)"
echo "- NPM: $(npm --version)"
echo ""

echo "🔧 Installing Dependencies..."
npm install
echo ""

echo "📦 Compiling Contracts..."
npx hardhat compile
echo ""

echo "🧪 Running Test Suite..."
echo "------------------------"

echo "1️⃣  Running Main Tests..."
npx hardhat test test/TransAgriEscrow.js
main_tests_result=$?

echo ""
echo "2️⃣  Running Edge Case Tests..."
npx hardhat test test/TransAgriEscrow.edge-cases.js
edge_tests_result=$?

echo ""
echo "3️⃣  Running Gas Optimization Tests..."
npx hardhat test test/TransAgriEscrow.gas.js
gas_tests_result=$?

echo ""
echo "📊 Test Results Summary:"
echo "========================"

if [ $main_tests_result -eq 0 ]; then
    echo "✅ Main Tests: PASSED"
else
    echo "❌ Main Tests: FAILED"
fi

if [ $edge_tests_result -eq 0 ]; then
    echo "✅ Edge Case Tests: PASSED"
else
    echo "❌ Edge Case Tests: FAILED"
fi

if [ $gas_tests_result -eq 0 ]; then
    echo "✅ Gas Optimization Tests: PASSED"
else
    echo "❌ Gas Optimization Tests: FAILED"
fi

echo ""

# Calculate overall success
total_tests=$((main_tests_result + edge_tests_result + gas_tests_result))

if [ $total_tests -eq 0 ]; then
    echo "🎉 ALL TESTS PASSED! Ready for deployment."
    echo ""
    
    echo "🚀 Deployment Options:"
    echo "======================"
    echo ""
    echo "📍 Local Development:"
    echo "   npm run setup      # Set up local environment with test data"
    echo "   npm run node       # Start local Hardhat node (in separate terminal)"
    echo "   npm run deploy:local"
    echo ""
    echo "🌐 Testnet Deployment (Celo Alfajores):"
    echo "   1. Set up .env file with your private key"
    echo "   2. npm run deploy:alfajores"
    echo "   3. npm run verify:alfajores"
    echo ""
    echo "🏭 Mainnet Deployment (Celo):"
    echo "   1. Set up .env file with your private key"
    echo "   2. npm run deploy:celo"
    echo "   3. npm run verify:celo"
    echo ""
    echo "📖 Additional Commands:"
    echo "   npm run interact   # Run interaction demo"
    echo "   npm run quick-test # Quick functionality test"
    echo "   npm run test:gas   # Detailed gas reporting"
    echo ""
    
    exit 0
else
    echo "❌ Some tests failed. Please review the output above and fix issues before deployment."
    echo ""
    echo "🔧 Troubleshooting:"
    echo "   - Check contract compilation: npm run compile"
    echo "   - Run individual test files to isolate issues"
    echo "   - Review test output for specific error messages"
    echo "   - Ensure all dependencies are installed: npm install"
    echo ""
    exit 1
fi
