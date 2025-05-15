import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";

dotenv.config();

const BATCH_SIZE = 200;

async function main() {
  const distributorAddress = process.env.TOKEN_DISTRIBUTOR_ADDRESS;
  if (!distributorAddress) {
    throw new Error("TOKEN_DISTRIBUTOR_ADDRESS no encontrada en .env.local");
  }

  console.log(
    `🚁 Ejecutando airdrop desde el distribuidor: ${distributorAddress}\n`
  );

  const [signer] = await ethers.getSigners();
  const distributor = await ethers.getContractAt(
    "TokenDistributor",
    distributorAddress
  );

  // Verificar estado
  const stats = await distributor.getStats();
  if (!stats._finalized) {
    throw new Error(
      "Las asignaciones no están finalizadas. Ejecuta primero 2-load-wl.ts"
    );
  }

  console.log("📊 Estado actual:");
  console.log(
    `   Total asignado: ${ethers.formatEther(stats._totalAllocated)} tokens`
  );
  console.log(
    `   Total distribuido: ${ethers.formatEther(
      stats._totalDistributed
    )} tokens`
  );
  console.log(
    `   Balance del contrato: ${ethers.formatEther(
      stats._contractBalance
    )} tokens`
  );

  // Leer direcciones de airdrop
  const airdropFile = path.join(__dirname, "test_airdrop_distribution.csv");
  const airdropCsv = fs.readFileSync(airdropFile, "utf-8");
  const airdropRecords = parse(airdropCsv, {
    columns: true,
    skip_empty_lines: true,
  });

  console.log(`\n📊 Direcciones de airdrop: ${airdropRecords.length}`);

  // Obtener solo las direcciones
  const airdropAddresses = airdropRecords.map(
    (r: { address: any }) => r.address
  );

  // Ejecutar en batches
  let processedCount = 0;
  let batchCount = 0;
  let successCount = 0;

  for (let i = 0; i < airdropAddresses.length; i += BATCH_SIZE) {
    const batch = airdropAddresses.slice(i, i + BATCH_SIZE);
    batchCount++;

    console.log(
      `\n📤 Procesando batch ${batchCount} (${batch.length} direcciones)...`
    );

    try {
      const tx = await distributor.executeInitialAirdrop(batch);
      console.log(`   Tx enviada: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`   ✅ Batch ${batchCount} confirmado`);

      processedCount += batch.length;
      successCount += batch.length;
    } catch (error: any) {
      console.error(`   ❌ Error en batch ${batchCount}:`, error.message);
    }
  }

  // Mostrar detalles del airdrop
  console.log("\n📋 Detalle del airdrop:");
  for (const record of airdropRecords) {
    const amount = ethers.parseEther(record.tokens.toString());
    console.log(
      `   ${record.address}: ${ethers.formatEther(amount)} tokens (${
        record.type || "airdrop"
      })`
    );
  }

  // Verificar estadísticas finales
  const finalStats = await distributor.getStats();

  console.log("\n📊 Estadísticas finales:");
  console.log(
    `   Total airdropped: ${ethers.formatEther(
      finalStats._totalAirdropped
    )} tokens`
  );
  console.log(
    `   Total distribuido: ${ethers.formatEther(
      finalStats._totalDistributed
    )} tokens`
  );
  console.log(
    `   Restante en contrato: ${ethers.formatEther(
      finalStats._contractBalance
    )} tokens`
  );

  console.log("\n✅ Airdrop completado!");
  console.log(`   Direcciones procesadas: ${processedCount}`);
  console.log(`   Exitosas: ${successCount}`);
  console.log(`   Fallidas: ${processedCount - successCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
