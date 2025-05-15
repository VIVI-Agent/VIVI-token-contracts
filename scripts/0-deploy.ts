// scripts/deploy-factory-complete.ts
import { ethers, run } from "hardhat";
import * as fs from "fs";
import csv from "csv-parse/sync";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

interface CSVRow {
  address: string;
  amount: string;
}

interface DeploymentResult {
  factory: string;
  token: string;
  distributor: string;
  pool: string;
  positionTokenId: string;
  launchBlock: number;
  launchTimestamp: number;
}

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("🚀 Desplegando TokenLaunchFactory y lanzando token...");
  console.log("🔑 Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "ETH\n");

  // Configuración
  const TOKEN_NAME = process.env.TOKEN_NAME || "Token";
  const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || "TTKK";
  const TOTAL_SUPPLY = process.env.TOKEN_TOTAL_SUPPLY || "1000000000";

  const LIQUIDITY_PERCENTAGE = 10; // 10% para liquidez
  const DISTRIBUTION_PERCENTAGE = 90; // 90% para distribución

  // Leer CSVs
  console.log("📂 Leyendo archivos CSV...");
  const airdropData = readCSV("airdrop-addresses.csv");
  const claimData = readCSV("claim-addresses.csv");

  console.log(`   ✅ ${airdropData.length} direcciones para airdrop`);
  console.log(`   ✅ ${claimData.length} direcciones para claim`);

  // Deploy del TokenLaunchFactory
  console.log("\n📡 Desplegando TokenLaunchFactory...");
  const TokenLaunchFactory = await ethers.getContractFactory(
    "TokenLaunchFactory"
  );
  const factory = await TokenLaunchFactory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();

  console.log("✅ TokenLaunchFactory desplegado en:", factoryAddress);

  // Preparar configuración del lanzamiento
  const totalSupplyBN = ethers.parseEther(TOTAL_SUPPLY);
  const liquidityTokens = (totalSupplyBN * BigInt(LIQUIDITY_PERCENTAGE)) / 100n;
  const distributionTokens =
    (totalSupplyBN * BigInt(DISTRIBUTION_PERCENTAGE)) / 100n;

  // Configuración del lanzamiento
  const launchConfig = {
    tokenName: TOKEN_NAME,
    tokenSymbol: TOKEN_SYMBOL,
    totalSupply: totalSupplyBN,
    liquidityTokenAmount: liquidityTokens,
    liquidityEthAmount: ethers.parseEther(process.env.LIQUIDITY_ETH || "0.1"),
    initialBuyEthAmount: ethers.parseEther(process.env.INITIAL_BUY || "0.01"),
    teamAddress: deployer.address,
    // Direcciones y cantidades para airdrop
    airdropAddresses: airdropData.map((row: CSVRow) => row.address),
    airdropAmounts: airdropData.map((row: CSVRow) =>
      ethers.parseEther(row.amount)
    ),
    // Direcciones y cantidades para claim
    claimAddresses: claimData.map((row: CSVRow) => row.address),
    claimAmounts: claimData.map((row: CSVRow) => ethers.parseEther(row.amount)),
  };

  // Validar distribución total
  const totalAirdrop = airdropData.reduce(
    (sum: bigint, row: CSVRow) => sum + ethers.parseEther(row.amount),
    0n
  );
  const totalClaim = claimData.reduce(
    (sum: bigint, row: CSVRow) => sum + ethers.parseEther(row.amount),
    0n
  );
  const totalDistribution = totalAirdrop + totalClaim;

  console.log("\n📊 Validando distribución:");
  console.log(
    `   Airdrop total: ${ethers.formatEther(totalAirdrop)} ${TOKEN_SYMBOL}`
  );
  console.log(
    `   Claim total: ${ethers.formatEther(totalClaim)} ${TOKEN_SYMBOL}`
  );
  console.log(
    `   Distribución total: ${ethers.formatEther(
      totalDistribution
    )} ${TOKEN_SYMBOL}`
  );
  console.log(
    `   Supply disponible: ${ethers.formatEther(
      distributionTokens
    )} ${TOKEN_SYMBOL}`
  );

  if (totalDistribution > distributionTokens) {
    throw new Error(`La distribución total excede el supply disponible`);
  }

  // Calcular ETH necesario
  const requiredEth =
    ethers.parseEther(process.env.LIQUIDITY_ETH || "1") +
    ethers.parseEther(process.env.INITIAL_BUY || "0.1");

  // Lanzar el token
  console.log("\n🚀 Lanzando token con configuración completa...");
  console.log(`   💰 Enviando ${ethers.formatEther(requiredEth)} ETH`);

  const tx = await factory.launchToken(launchConfig, {
    value: requiredEth,
    gasLimit: 50000000, // Gas alto para evitar problemas
  });

  console.log("⏳ Esperando confirmación... TX:", tx.hash);
  const receipt = await tx.wait();

  console.log("✅ Token lanzado exitosamente!");

  // Obtener evento y datos del lanzamiento
  const event = receipt?.logs.find((log: any) => {
    try {
      const parsed = factory.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      return parsed?.name === "TokenLaunched";
    } catch {
      return false;
    }
  });

  if (!event) {
    throw new Error("No se encontró el evento TokenLaunched");
  }

  const parsedEvent = factory.interface.parseLog({
    topics: event.topics as string[],
    data: event.data,
  });

  const token = parsedEvent?.args?.token || "";
  const distributor = parsedEvent?.args?.distributor || "";
  const pool = parsedEvent?.args?.pool || "";
  const positionTokenId = parsedEvent?.args?.positionTokenId || "";

  console.log("\n📋 Resultados del lanzamiento:");
  console.log("   Token:", token);
  console.log("   Distribuidor:", distributor);
  console.log("   Pool:", pool);
  console.log("   Position Token ID:", positionTokenId.toString());

  // Verificar éxito
  console.log("\n🔍 Verificando deployment...");

  // Verificar token
  const tokenContract = await ethers.getContractAt("PlainERC20Factory", token);
  const name = await tokenContract.name();
  const symbol = await tokenContract.symbol();
  const totalSupply = await tokenContract.totalSupply();

  console.log(`   Token: ${name} (${symbol})`);
  console.log(`   Total Supply: ${ethers.formatEther(totalSupply)}`);

  // Verificar distribuidor
  const distributorContract = await ethers.getContractAt(
    "TokenDistributor",
    distributor
  );
  const configuredToken = await distributorContract.token();
  console.log(
    `   Token en distribuidor: ${configuredToken === token ? "✅" : "❌"}`
  );

  if (!receipt) throw new Error("No se encontró el recibo de la transacción");

  // Guardar resultados
  const deploymentResult: DeploymentResult = {
    factory: factoryAddress,
    token,
    distributor,
    pool,
    positionTokenId: positionTokenId.toString(),
    launchBlock: receipt?.blockNumber,
    launchTimestamp: Date.now(),
  };

  // Guardar información detallada
  const deploymentInfo = {
    deployedAt: new Date().toISOString(),
    contracts: {
      factory: factoryAddress,
      token: {
        address: token,
        name: TOKEN_NAME,
        symbol: TOKEN_SYMBOL,
        totalSupply: TOTAL_SUPPLY,
        liquidityAmount: ethers.formatEther(liquidityTokens),
        distributionAmount: ethers.formatEther(distributionTokens),
      },
      distributor: {
        address: distributor,
        totalAirdrop: ethers.formatEther(totalAirdrop),
        totalClaim: ethers.formatEther(totalClaim),
        airdropRecipients: airdropData.length,
        claimRecipients: claimData.length,
      },
      pool: {
        address: pool,
        token0: token < (await factory.WETH()) ? token : await factory.WETH(),
        token1: token < (await factory.WETH()) ? await factory.WETH() : token,
        fee: "10000", // 1%
        positionTokenId: positionTokenId.toString(),
      },
    },
    deployer: deployer.address,
    transaction: {
      hash: tx.hash,
      block: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    },
  };

  fs.writeFileSync(
    path.join(__dirname, "deployment/deployment-info.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("\n📄 Información guardada en deployment-info.json");

  // Actualizar .env.local
  const envContent = `# Factory y contratos desplegados
FACTORY_ADDRESS=${factoryAddress}
TOKEN_ADDRESS=${token}
DISTRIBUTOR_ADDRESS=${distributor}
POOL_ADDRESS=${pool}
POSITION_TOKEN_ID=${positionTokenId}
`;

  fs.writeFileSync(".env.local", envContent);
  console.log("📄 Direcciones guardadas en .env.local");

  // Verificar contratos en Basescan (si no es localhost)
  console.log("\n🔍 Esperando 30 segundos antes de verificar...");
  await new Promise((resolve) => setTimeout(resolve, 30000));

  try {
    await verifyContracts(deploymentResult, launchConfig);
  } catch (error) {
    console.error("❌ Error verificando contratos:", error);
  }

  console.log("\n🎉 Deployment completado exitosamente!");
  console.log("\n📋 Información importante:");
  console.log(`   Token: ${token}`);
  console.log(`   Pool: ${pool}`);
  console.log(`   Distribuidor: ${distributor}`);
  console.log(`   Position NFT ID: ${positionTokenId}`);
  console.log("\n🔗 Pool en Basescan:");
  console.log(`   https://basescan.org/address/${pool}`);
}

function readCSV(filename: string): CSVRow[] {
  const fileContent = fs.readFileSync(path.join(__dirname, filename), "utf-8");
  const records = csv.parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
  });
  return records as CSVRow[];
}

async function verifyContracts(result: DeploymentResult, config: any) {
  console.log("\n📝 Verificando contratos en Basescan...");

  try {
    // Verificar Factory
    console.log("Verificando TokenLaunchFactory...");
    await run("verify:verify", {
      address: result.factory,
      constructorArguments: [],
      contract: "contracts/TokenLaunchFactory.sol:TokenLaunchFactory",
    });
    console.log("✅ Factory verificado");

    console.log("Verificando PlainERC20Factory...");
    await run("verify:verify", {
      address: result.factory,
      constructorArguments: [],
      contract: "contracts/PlainERC20Factory.sol:PlainERC20Factory",
    });
    console.log("✅ PlainERC20Factory verificado");

    console.log("Verificando TokenDistributor...");
    await run("verify:verify", {
      address: result.factory,
      constructorArguments: [],
      contract: "contracts/TokenDistributor.sol:TokenDistributor",
    });
    console.log("✅ TokenDistributor verificado");

    // Los demás contratos son creados por el factory
    // y pueden necesitar verificación manual
    console.log(
      "\n⚠️  Nota: Token y Distribuidor fueron desplegados por el factory."
    );
    console.log("    Pueden requerir verificación manual en Basescan.");
  } catch (error: any) {
    if (error.message.includes("already verified")) {
      console.log("✅ Contrato ya verificado");
    } else {
      throw error;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
