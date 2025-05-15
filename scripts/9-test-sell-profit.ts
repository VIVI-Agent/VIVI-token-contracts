// scripts/validate-tier1-profit.ts
import { ethers } from "hardhat";
import * as fs from "fs";
import { formatEther, parseEther } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Direcciones de contratos desplegados (actualizar después del deploy)
const DEPLOYED_CONTRACTS = {
  token: process.env.TOKEN_ADDRESS || "",
  distributor: process.env.DISTRIBUTOR_ADDRESS || "",
  pool: process.env.POOL_ADDRESS || "",
};

// Configuración para Base Sepolia
const BASE_SEPOLIA_CONFIG = {
  chainId: 84532,
  rpcUrl: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
  weth: "0x4200000000000000000000000000000000000006",
  swapRouter: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
};

// Wallet de prueba Tier 1
const TEST_WALLET = {
  address: "0xee95490379C19c6f80a9cB499379fB3b87B9C85b",
  privateKey:
    "0x7609b6ae9ba338c695ba5951782d297672e0a40d2a382ab2d5b2d2dd4f5ffc8c",
  expectedTokens: "25037096", // Ajustar según el CSV
  tier1PricePerToken: "0.0000000399", // Precio promedio tier 1
};

// ABI mínimo del Swap Router
const SWAP_ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
];

// ABI mínimo del Token
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

// ABI mínimo del Distributor
const DISTRIBUTOR_ABI = [
  "function claimTokens() external",
  "function getUserInfo(address user) external view returns (uint256 allocation, bool claimed, uint8 distType, bool canClaim)",
  "function claimingEnabled() external view returns (bool)",
];

async function main() {
  console.log("🔬 Validación de Profit Tier 1 en Base Sepolia");
  console.log("════════════════════════════════════════════\n");

  // Verificar que tengamos las direcciones
  if (!DEPLOYED_CONTRACTS.token || !DEPLOYED_CONTRACTS.distributor) {
    console.error(
      "❌ Por favor configura las direcciones de los contratos en .env"
    );
    console.error("   TOKEN_ADDRESS=0x...");
    console.error("   DISTRIBUTOR_ADDRESS=0x...");
    console.error("   POOL_ADDRESS=0x...");
    process.exit(1);
  }

  // Configurar provider y wallet
  const provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_CONFIG.rpcUrl);
  const testWallet = new ethers.Wallet(TEST_WALLET.privateKey, provider);

  console.log("📊 Configuración:");
  console.log(`   Test Wallet: ${testWallet.address}`);
  console.log(`   Token: ${DEPLOYED_CONTRACTS.token}`);
  console.log(`   Distributor: ${DEPLOYED_CONTRACTS.distributor}`);

  // 1. VERIFICAR BALANCE INICIAL
  const initialEthBalance = await provider.getBalance(testWallet.address);
  console.log(`\n💰 Balance inicial ETH: ${formatEther(initialEthBalance)}`);

  // 2. HACER CLAIM SI ES NECESARIO
  const distributor = new ethers.Contract(
    DEPLOYED_CONTRACTS.distributor,
    DISTRIBUTOR_ABI,
    testWallet
  );

  const userInfo = await distributor.getUserInfo(testWallet.address);
  console.log("\n📋 Estado del claim:");
  console.log(`   Allocation: ${formatEther(userInfo.allocation)} tokens`);
  console.log(`   Ya reclamó: ${userInfo.claimed ? "Sí" : "No"}`);
  console.log(`   Puede reclamar: ${userInfo.canClaim ? "Sí" : "No"}`);

  if (userInfo.canClaim && !userInfo.claimed) {
    console.log("\n🎯 Ejecutando claim...");
    const claimTx = await distributor.claimTokens();
    console.log(`   TX: ${claimTx.hash}`);
    await claimTx.wait();
    console.log("   ✅ Claim exitoso!");
  } else if (userInfo.claimed) {
    console.log("   ℹ️  Tokens ya fueron reclamados anteriormente");
  }

  // 3. VERIFICAR BALANCE DE TOKENS
  const token = new ethers.Contract(
    DEPLOYED_CONTRACTS.token,
    ERC20_ABI,
    testWallet
  );

  const tokenBalance = await token.balanceOf(testWallet.address);
  console.log(`\n🪙 Balance de tokens: ${formatEther(tokenBalance)}`);

  if (tokenBalance === 0n) {
    console.error("❌ No hay tokens para vender!");
    process.exit(1);
  }

  // 4. EJECUTAR VENTA
  console.log("\n🔄 Preparando venta de tokens...");

  // Aprobar tokens
  console.log("   Aprobando tokens para swap router...");
  const approveTx = await token.approve(
    BASE_SEPOLIA_CONFIG.swapRouter,
    tokenBalance
  );
  await approveTx.wait();
  console.log("   ✅ Tokens aprobados");

  // Ejecutar swap
  const swapRouter = new ethers.Contract(
    BASE_SEPOLIA_CONFIG.swapRouter,
    SWAP_ROUTER_ABI,
    testWallet
  );

  const swapParams = {
    tokenIn: DEPLOYED_CONTRACTS.token,
    tokenOut: BASE_SEPOLIA_CONFIG.weth,
    fee: 10000, // 1%
    recipient: testWallet.address,
    amountIn: tokenBalance,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0,
  };

  console.log("\n💸 Ejecutando swap...");
  console.log(`   Vendiendo: ${formatEther(tokenBalance)} tokens`);

  const ethBalanceBefore = await provider.getBalance(testWallet.address);

  const swapTx = await swapRouter.exactInputSingle(swapParams);
  console.log(`   TX: ${swapTx.hash}`);
  const swapReceipt = await swapTx.wait();

  const ethBalanceAfter = await provider.getBalance(testWallet.address);

  // 5. CALCULAR PROFIT
  const gasUsed = swapReceipt.gasUsed * swapReceipt.gasPrice;
  const ethReceived = ethBalanceAfter - ethBalanceBefore;

  console.log("\n📊 Resultados:");
  console.log(`   ETH recibido: ${formatEther(ethReceived)}`);
  console.log(`   Gas usado: ${formatEther(gasUsed)}`);

  // Calcular profit basado en el precio tier 1
  const tier1Price = parseEther(TEST_WALLET.tier1PricePerToken);
  const originalContribution = (tokenBalance * tier1Price) / parseEther("1");

  console.log(
    `   Contribución original estimada: ${formatEther(
      originalContribution
    )} ETH`
  );

  const profitRatio = Number(ethReceived) / Number(originalContribution);
  const profitPercentage = (profitRatio - 1) * 100;

  console.log(`\n🎯 PROFIT OBTENIDO: ${profitPercentage.toFixed(2)}%`);
  console.log(`   Multiplicador: ${profitRatio.toFixed(3)}x`);

  if (profitPercentage >= 45 && profitPercentage <= 55) {
    console.log("   ✅ Profit está cerca del 50% objetivo!");
  } else if (profitPercentage > 55) {
    console.log("   ⚠️  Profit excede el 50% objetivo");
  } else {
    console.log("   ❌ Profit está por debajo del 50% objetivo");
  }

  // 6. GUARDAR RESULTADOS
  const results = {
    timestamp: new Date().toISOString(),
    network: "Base Sepolia",
    testWallet: testWallet.address,
    contracts: DEPLOYED_CONTRACTS,
    tokensSold: formatEther(tokenBalance),
    ethReceived: formatEther(ethReceived),
    originalContribution: formatEther(originalContribution),
    profitPercentage: profitPercentage.toFixed(2),
    profitMultiplier: profitRatio.toFixed(3),
    transactionHashes: {
      claim: userInfo.claimed ? "Already claimed" : "New claim",
      swap: swapTx.hash,
    },
    explorer: `https://sepolia.basescan.org/tx/${swapTx.hash}`,
  };

  fs.writeFileSync(
    "tier1-profit-validation.json",
    JSON.stringify(results, null, 2)
  );

  console.log("\n✅ Validación completada!");
  console.log("📄 Resultados guardados en tier1-profit-validation.json");
  console.log(`\n🔗 Ver transacción: ${results.explorer}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
