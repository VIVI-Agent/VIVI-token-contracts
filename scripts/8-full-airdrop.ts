import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const distributorAddress = process.env.DISTRIBUTOR_ADDRESS;
  if (!distributorAddress) {
    throw new Error("TOKEN_DISTRIBUTOR_ADDRESS no encontrada en .env.local");
  }

  const BATCH_SIZE = 200;

  console.log(`🚨 AIRDROP ALL en el distribuidor: ${distributorAddress}\n`);
  console.log(`⚠️  ADVERTENCIA: Esta acción es IRREVERSIBLE`);
  console.log(`   - Cerrará el claiming permanentemente`);
  console.log(`   - Distribuirá todos los tokens pendientes`);

  const [signer] = await ethers.getSigners();
  const distributor = await ethers.getContractAt(
    "TokenDistributor",
    distributorAddress
  );

  // Obtener el estado actual
  const stats = await distributor.getStats();
  console.log("\n📊 Estado actual:");
  console.log(
    `   Total asignado: ${ethers.formatEther(stats._totalAllocated)} tokens`
  );
  console.log(
    `   Total distribuido: ${ethers.formatEther(
      stats._totalDistributed
    )} tokens`
  );
  console.log(
    `   Total claimed: ${ethers.formatEther(stats._totalClaimed)} tokens`
  );
  console.log(
    `   Total airdropped: ${ethers.formatEther(stats._totalAirdropped)} tokens`
  );
  console.log(
    `   Balance del contrato: ${ethers.formatEther(
      stats._contractBalance
    )} tokens`
  );
  console.log(`   Direcciones pendientes: ${stats._pendingCount}`);
  console.log(`   Claiming habilitado: ${stats._claimingEnabled}`);

  const pendingCount = Number(stats._pendingCount);
  if (pendingCount === 0) {
    console.log("\n✅ No hay direcciones pendientes.");

    // Si hay balance no asignado, recuperarlo
    const unallocated =
      stats._contractBalance + stats._totalDistributed - stats._totalAllocated;
    if (unallocated > 0n) {
      console.log(
        `\n💰 Balance no asignado: ${ethers.formatEther(unallocated)} tokens`
      );
      console.log("   Recuperando al owner...");

      try {
        const tx = await distributor.recoverUnallocatedTokens();
        console.log(`   Tx enviada: ${tx.hash}`);
        await tx.wait();
        console.log("   ✅ Tokens recuperados");
      } catch (error) {
        console.error("   ❌ Error recuperando tokens:", error);
      }
    }
    return;
  }

  // Calcular batches necesarios
  const totalBatches = Math.ceil(pendingCount / BATCH_SIZE);
  console.log(
    `\n📋 Se procesarán ${pendingCount} direcciones en ${totalBatches} batches`
  );

  // Confirmar
  console.log("\n⚠️  ¿Estás seguro? (Ctrl+C para cancelar)");
  console.log("   Continuando en 5 segundos...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Ejecutar emergency airdrop
  let batchNumber = 0;
  let currentPendingCount = pendingCount;

  while (currentPendingCount > 0) {
    batchNumber++;
    console.log(`\n📤 Procesando batch ${batchNumber}/${totalBatches}...`);
    console.log(`   Direcciones restantes: ${currentPendingCount}`);

    try {
      const tx = await distributor.airdropAll(BATCH_SIZE);
      console.log(`   Tx enviada: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(
        `   ✅ Batch ${batchNumber} confirmado en bloque ${receipt?.blockNumber}`
      );

      // Buscar eventos en los logs
      if (receipt?.logs) {
        for (const log of receipt.logs) {
          try {
            const parsedLog = distributor.interface.parseLog(log);
            if (parsedLog?.name === "AirdropAllCompleted") {
              console.log(`   📊 Resultado del batch:`);
              console.log(
                `      Direcciones procesadas: ${parsedLog.args.addressesProcessed}`
              );
              console.log(
                `      Tokens distribuidos: ${ethers.formatEther(
                  parsedLog.args.tokensDistributed
                )}`
              );
            }
          } catch (e) {
            // Ignorar logs que no son del contrato
          }
        }
      }

      // Actualizar contador
      const currentStats = await distributor.getStats();
      currentPendingCount = Number(currentStats._pendingCount);
    } catch (error: any) {
      console.error(`   ❌ Error en batch ${batchNumber}:`, error.message);
      throw error;
    }
  }

  // Verificar estado final
  const finalStats = await distributor.getStats();

  console.log("\n📊 Estado final:");
  console.log(
    `   Total distribuido: ${ethers.formatEther(
      finalStats._totalDistributed
    )} tokens`
  );
  console.log(
    `   Total claimed: ${ethers.formatEther(finalStats._totalClaimed)} tokens`
  );
  console.log(
    `   Total airdropped: ${ethers.formatEther(
      finalStats._totalAirdropped
    )} tokens`
  );
  console.log(
    `   Balance del contrato: ${ethers.formatEther(
      finalStats._contractBalance
    )} tokens`
  );
  console.log(`   Claiming habilitado: ${finalStats._claimingEnabled}`);
  console.log(`   Direcciones pendientes: ${finalStats._pendingCount}`);

  console.log("\n🏁 EMERGENCY AIRDROP COMPLETADO");
  console.log(`   Todos los tokens han sido distribuidos`);
  console.log(`   Claiming cerrado permanentemente`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
