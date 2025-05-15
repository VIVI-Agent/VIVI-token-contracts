// scripts/deploy-mainnet.ts
import { ethers } from "hardhat";
import { formatEther, parseEther } from "ethers";
import * as fs from "fs";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";

dotenv.config();

// Configuración para Base Mainnet
const MAINNET_CONFIG = {
  network: "Base Mainnet",
  chainId: 8453,
  // Liquidez inicial (1% del supply = 10M tokens con 0.5 ETH)
  liquidityConfig: {
    tokenAmount: parseEther("10000000"), // 10M tokens
    ethAmount: parseEther("0.5"), // 0.5 ETH
    initialBuyEth: parseEther("0.05"), // 0.05 ETH para primera compra
  },
  teamAddress: process.env.TEAM_ADDRESS || "",
};

async function main() {
  console.log("🚀 Desplegando en Base Mainnet...");
  console.log("═══════════════════════════════\n");

  // Verificar configuración
  if (!MAINNET_CONFIG.teamAddress) {
    throw new Error("Por favor configura TEAM_ADDRESS en .env");
  }

  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer:", deployer.address);
  console.log(
    "💰 Balance:",
    formatEther(await deployer.provider.getBalance(deployer.address)),
    "ETH"
  );

  // Leer CSVs para whitelist
  console.log("\n📄 Leyendo whitelists...");

  // Airdrop CSV
  const airdropCsv = fs.readFileSync("./scripts/airdrop-1.csv", "utf-8");
  const airdropRecords = parse(airdropCsv, {
    columns: true,
    skip_empty_lines: true,
  });

  const airdropAddresses = airdropRecords.map(
    (r: { address: any }) => r.address
  );
  const airdropAmounts = airdropRecords.map((r: { tokens: string }) =>
    parseEther(r.tokens)
  );

  console.log(`   Airdrop: ${airdropAddresses.length} direcciones`);

  // Claim CSV
  const claimCsv = fs.readFileSync("./scripts/claim-addresses.csv", "utf-8");
  const claimRecords = parse(claimCsv, {
    columns: true,
    skip_empty_lines: true,
  });

  const claimAddresses = claimRecords.map((r: { address: any }) => r.address);
  const claimAmounts = claimRecords.map((r: { tokens: string }) =>
    parseEther(r.tokens)
  );

  console.log(`   Claim: ${claimAddresses.length} direcciones`);

  // Deploy del Factory
  console.log("\n📦 Desplegando Factory...");
  const TokenLaunchFactory = await ethers.getContractFactory(
    "TokenLaunchFactory"
  );
  const factory = await TokenLaunchFactory.deploy();
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  console.log("   ✅ Factory desplegado en:", factoryAddress);

  // Preparar configuración de lanzamiento
  const launchConfig = {
    tokenName: "TJF Coin",
    tokenSymbol: "TJF",
    totalSupply: parseEther("1000000000"), // 1B tokens
    liquidityTokenAmount: MAINNET_CONFIG.liquidityConfig.tokenAmount,
    liquidityEthAmount: MAINNET_CONFIG.liquidityConfig.ethAmount,
    initialBuyEthAmount: MAINNET_CONFIG.liquidityConfig.initialBuyEth,
    teamAddress: MAINNET_CONFIG.teamAddress,
    airdropAddresses,
    airdropAmounts,
    claimAddresses,
    claimAmounts,
  };

  // Calcular ETH necesario
  const totalEthNeeded =
    MAINNET_CONFIG.liquidityConfig.ethAmount +
    MAINNET_CONFIG.liquidityConfig.initialBuyEth;

  console.log(`\n💸 ETH necesario: ${formatEther(totalEthNeeded)}`);

  // Lanzar token
  console.log("\n🚀 Lanzando token...");
  const tx = await factory.launchToken(launchConfig, { value: totalEthNeeded });
  console.log("   TX:", tx.hash);

  const receipt = await tx.wait();
  console.log("   ✅ Token lanzado en bloque:", receipt?.blockNumber);

  // Obtener direcciones del evento
  let tokenAddress, distributorAddress, poolAddress, positionTokenId;
  if (!receipt?.logs) {
    throw new Error("No se encontraron logs en la transacción");
  }
  for (const log of receipt.logs) {
    try {
      const parsedLog = factory.interface.parseLog(log);
      if (parsedLog?.name === "TokenLaunched") {
        tokenAddress = parsedLog.args.token;
        distributorAddress = parsedLog.args.distributor;
        poolAddress = parsedLog.args.pool;
        positionTokenId = parsedLog.args.positionTokenId;
        break;
      }
    } catch (e) {
      // Ignorar logs que no son del factory
    }
  }

  console.log("\n📋 Contratos desplegados:");
  console.log(`   Token: ${tokenAddress}`);
  console.log(`   Distributor: ${distributorAddress}`);
  console.log(`   Pool: ${poolAddress}`);
  console.log(`   Position NFT ID: ${positionTokenId}`);

  // Guardar configuración
  const deploymentInfo = {
    network: MAINNET_CONFIG.network,
    chainId: MAINNET_CONFIG.chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      factory: factoryAddress,
      token: tokenAddress,
      distributor: distributorAddress,
      pool: poolAddress,
    },
    positionTokenId: positionTokenId.toString(),
    launchConfig: {
      tokenName: launchConfig.tokenName,
      tokenSymbol: launchConfig.tokenSymbol,
      totalSupply: formatEther(launchConfig.totalSupply),
      liquidityTokenAmount: formatEther(launchConfig.liquidityTokenAmount),
      liquidityEthAmount: formatEther(launchConfig.liquidityEthAmount),
      initialBuyEthAmount: formatEther(launchConfig.initialBuyEthAmount),
      teamAddress: launchConfig.teamAddress,
    },
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber,
  };

  fs.writeFileSync(
    `deployment-mainnet-${Date.now()}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n✅ Deploy completado!");
  console.log("📄 Información guardada en deployment-mainnet-*.json");

  // Actualizar .env
  console.log("\n⚠️  IMPORTANTE: Actualiza tu .env con:");
  console.log(`TOKEN_ADDRESS=${tokenAddress}`);
  console.log(`DISTRIBUTOR_ADDRESS=${distributorAddress}`);
  console.log(`POOL_ADDRESS=${poolAddress}`);
  console.log(`POSITION_TOKEN_ID=${positionTokenId}`);

  console.log("\n🔗 Basescan:");
  console.log(`   Token: https://basescan.org/address/${tokenAddress}`);
  console.log(
    `   Distributor: https://basescan.org/address/${distributorAddress}`
  );
  console.log(`   Pool: https://basescan.org/address/${poolAddress}`);
  console.log(`   TX: https://basescan.org/tx/${tx.hash}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
