// scripts/0-deploy.ts
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

  console.log("🚀 Desplegando VIVIFactory y lanzando token...");
  console.log("🔑 Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "ETH\n");

  // Configuración
  const TOKEN_NAME = process.env.TOKEN_NAME || "Token";
  const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || "TTKK";
  const TOTAL_SUPPLY = process.env.TOKEN_TOTAL_SUPPLY || "1000000000";

  const LIQUIDITY_PERCENTAGE = 10; // 10% para liquidez
  const DISTRIBUTION_PERCENTAGE = 90; // 90% para distribución

  // Leer CSVs - Ahora son 3 archivos
  console.log("📂 Leyendo archivos CSV...");
  const airdrop1Data = readCSV("airdrop-1.csv");
  const airdrop2Data = readCSV("airdrop-2.csv");
  const claimData = readCSV("claim-addresses.csv");

  console.log(
    `   ✅ ${airdrop1Data.length} direcciones en airdrop1 (team/treasury)`
  );
  console.log(
    `   ✅ ${airdrop2Data.length} direcciones en airdrop2 (especiales)`
  );
  console.log(`   ✅ ${claimData.length} direcciones para claim`);

  // Deploy del VIVIFactory
  console.log("\n📡 Desplegando VIVIFactory...");
  const VIVIFactory = await ethers.getContractFactory("VIVIFactory");
  const factory = await VIVIFactory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();

  console.log("✅ VIVIFactory desplegado en:", factoryAddress);

  // Preparar configuración del lanzamiento
  const totalSupplyBN = ethers.parseEther(TOTAL_SUPPLY);
  const liquidityTokens = (totalSupplyBN * BigInt(LIQUIDITY_PERCENTAGE)) / 100n;
  const distributionTokens =
    (totalSupplyBN * BigInt(DISTRIBUTION_PERCENTAGE)) / 100n;

  // Configuración del lanzamiento
  // Combinar ambos archivos de airdrop
  const allAirdropAddresses = [
    ...airdrop1Data.map((row: CSVRow) => row.address),
    ...airdrop2Data.map((row: CSVRow) => row.address),
  ];
  const allAirdropAmounts = [
    ...airdrop1Data.map((row: CSVRow) => ethers.parseEther(row.amount)),
    ...airdrop2Data.map((row: CSVRow) => ethers.parseEther(row.amount)),
  ];

  const launchConfig = {
    tokenName: TOKEN_NAME,
    tokenSymbol: TOKEN_SYMBOL,
    totalSupply: totalSupplyBN,
    liquidityTokenAmount: liquidityTokens,
    liquidityEthAmount: ethers.parseEther(process.env.LIQUIDITY_ETH || "0.1"),
    initialBuyEthAmount: ethers.parseEther(process.env.INITIAL_BUY || "0.01"),
    teamAddress: deployer.address,
    // Direcciones y cantidades para airdrop (combinando airdrop1 y airdrop2)
    airdropAddresses: allAirdropAddresses,
    airdropAmounts: allAirdropAmounts,
    // Direcciones y cantidades para claim
    claimAddresses: claimData.map((row: CSVRow) => row.address),
    claimAmounts: claimData.map((row: CSVRow) => ethers.parseEther(row.amount)),
  };

  // Validar distribución total
  const totalAirdrop1 = airdrop1Data.reduce(
    (sum: bigint, row: CSVRow) => sum + ethers.parseEther(row.amount),
    0n
  );
  const totalAirdrop2 = airdrop2Data.reduce(
    (sum: bigint, row: CSVRow) => sum + ethers.parseEther(row.amount),
    0n
  );
  const totalClaim = claimData.reduce(
    (sum: bigint, row: CSVRow) => sum + ethers.parseEther(row.amount),
    0n
  );
  const totalAirdrop = totalAirdrop1 + totalAirdrop2;
  const totalDistribution = totalAirdrop + totalClaim;

  console.log("\n📊 Validando distribución:");
  console.log(
    `   Airdrop1 (team/treasury): ${ethers.formatEther(
      totalAirdrop1
    )} ${TOKEN_SYMBOL}`
  );
  console.log(
    `   Airdrop2 (especiales): ${ethers.formatEther(
      totalAirdrop2
    )} ${TOKEN_SYMBOL}`
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
    )} ${TOKEN_SYMBOL} (90%)`
  );
  console.log(
    `   Liquidez: ${ethers.formatEther(liquidityTokens)} ${TOKEN_SYMBOL} (10%)`
  );

  if (totalDistribution > distributionTokens) {
    throw new Error(`La distribución total excede el supply disponible`);
  }

  // Calcular ETH necesario
  const requiredEth =
    ethers.parseEther(process.env.LIQUIDITY_ETH || "0.1") +
    ethers.parseEther(process.env.INITIAL_BUY || "0.01");

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
  const tokenContract = await ethers.getContractAt("VIVIdotWIN", token);
  const name = await tokenContract.name();
  const symbol = await tokenContract.symbol();
  const totalSupply = await tokenContract.totalSupply();

  console.log(`   Token: ${name} (${symbol})`);
  console.log(`   Total Supply: ${ethers.formatEther(totalSupply)}`);

  // Verificar distribuidor
  const distributorContract = await ethers.getContractAt(
    "VIVIDistro",
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
        totalAirdrop1: ethers.formatEther(totalAirdrop1),
        totalAirdrop2: ethers.formatEther(totalAirdrop2),
        totalClaim: ethers.formatEther(totalClaim),
        airdrop1Recipients: airdrop1Data.length,
        airdrop2Recipients: airdrop2Data.length,
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

  // Crear directorio deployment si no existe
  const deploymentDir = path.join(__dirname, "deployment");
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(deploymentDir, "deployment-info.json"),
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
  console.log("\n🔍 Esperando 1 segundos antes de verificar...");
  await new Promise((resolve) => setTimeout(resolve, 1000));

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
  const tokenConstructorArgs = [
    config.tokenName,
    config.tokenSymbol,
    config.totalSupply,
    result.factory, // liquidityRecipient (el factory recibe para liquidez)
    config.liquidityTokenAmount,
    result.distributor, // distributorRecipient
  ];
  try {
    // Esperar un poco más para dar tiempo a Basescan de indexar

    // Verificar Token
    console.log("\nVerificando Token...");
    await run("verify:verify", {
      address: result.token,
      constructorArguments: tokenConstructorArgs,
      contract: "contracts/VIVIdotWIN.sol:VIVIdotWIN",
    });
    console.log("✅ Token verificado");

    // Verificar Distributor
    console.log("\nVerificando VIVIDistro...");
    const distributorConstructorArgs = [
      result.factory, // owner inicial (el factory)
    ];
    await run("verify:verify", {
      address: result.distributor,
      constructorArguments: distributorConstructorArgs,
      contract: "contracts/VIVIDistro.sol:VIVIDistro",
    });
    console.log("✅ Distributor verificado");

    // Verificar Factory
    console.log("Verificando VIVIFactory...");
    await run("verify:verify", {
      address: result.factory,
      constructorArguments: [],
      contract: "contracts/VIVIFactory.sol:VIVIFactory",
    });
    console.log("✅ Factory verificado");

    console.log("\n✅ Todos los contratos verificados exitosamente!");
  } catch (error: any) {
    if (error.message.includes("already verified")) {
      console.log("✅ Contrato ya verificado");
    } else if (error.message.includes("does not have bytecode")) {
      console.log("⚠️  Esperando que el contrato sea indexado por Basescan...");
      console.log("    Intenta verificar manualmente más tarde.");
    } else {
      console.error("❌ Error en verificación:", error.message);
      console.log("\n💡 Tip: Si la verificación falla, puedes intentar:");
      console.log("    1. Ejecutar el script de verificación por separado");
      console.log("    2. Verificar manualmente en Basescan");
      console.log("    3. Usar el siguiente comando para cada contrato:");
      console.log(
        `       npx hardhat verify --network base ${
          result.token
        } ${tokenConstructorArgs.join(" ")}`
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
