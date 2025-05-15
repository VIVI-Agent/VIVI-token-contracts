// scripts/1-airdrop-team-treasury.ts
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const distributorAddress = process.env.DISTRIBUTOR_ADDRESS;
  if (!distributorAddress) {
    throw new Error("DISTRIBUTOR_ADDRESS no encontrada en .env.local");
  }

  console.log(
    `🚁 Ejecutando airdrop Team/Treasury desde el distribuidor: ${distributorAddress}\n`
  );

  const [signer] = await ethers.getSigners();
  const distributor = await ethers.getContractAt(
    "VIVIDistro",
    distributorAddress
  );

  // Verificar estado
  const stats = await distributor.getStats();
  if (!stats._finalized) {
    throw new Error("Las asignaciones no están finalizadas");
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

  // Leer direcciones de airdrop desde airdrop1.csv
  const airdropFile = path.join(__dirname, "airdrop-1.csv");
  const airdropCsv = fs.readFileSync(airdropFile, "utf-8");
  const airdropRecords = parse(airdropCsv, {
    columns: true,
    skip_empty_lines: true,
  });

  console.log(
    `\n📋 Team/Treasury Airdrop: ${airdropRecords.length} direcciones`
  );

  // Mostrar detalle de las direcciones
  console.log("\nDirecciones a procesar:");
  for (const record of airdropRecords) {
    console.log(
      `   ${record.address}: ${record.amount} tokens (team/treasury)`
    );
  }

  // Obtener solo las direcciones para el batch
  const airdropAddresses = airdropRecords.map(
    (r: { address: any }) => r.address
  );

  // Ejecutar airdrop en batch
  console.log(
    `\n📤 Procesando airdrop de ${airdropAddresses.length} direcciones...`
  );

  try {
    const tx = await distributor.executeInitialAirdrop(airdropAddresses);
    console.log(`   Tx enviada: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(
      `   ✅ Airdrop team/treasury confirmado en bloque ${receipt?.blockNumber}`
    );

    // Buscar eventos en los logs
    let totalAirdropped = 0n;
    if (receipt?.logs) {
      for (const log of receipt.logs) {
        try {
          const parsedLog = distributor.interface.parseLog(log);
          if (parsedLog?.name === "TokensAirdropped") {
            const amount = parsedLog.args.amount;
            totalAirdropped += amount;
            console.log(
              `   ✓ ${parsedLog.args.user}: ${ethers.formatEther(
                amount
              )} tokens`
            );
          }
        } catch (e) {
          // Ignorar logs que no son del contrato
        }
      }
    }

    console.log(
      `\n💰 Total distribuido en este airdrop: ${ethers.formatEther(
        totalAirdropped
      )} tokens`
    );
  } catch (error: any) {
    console.error(`   ❌ Error en airdrop:`, error.message);
    throw error;
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

  console.log("\n✅ Airdrop Team/Treasury completado!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
