import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const distributorAddress = process.env.DISTRIBUTOR_ADDRESS;
  if (!distributorAddress) {
    throw new Error("DISTRIBUTOR_ADDRESS no encontrada en .env.local");
  }

  console.log(
    `🔓 Activando el claim en el distribuidor: ${distributorAddress}\n`
  );

  const [signer] = await ethers.getSigners();
  const distributor = await ethers.getContractAt(
    "TokenDistributor",
    distributorAddress
  );

  // Verificar el estado actual
  const stats = await distributor.getStats();

  console.log("📊 Estado actual:");
  console.log(`   Allocations finalizadas: ${stats._finalized}`);
  console.log(`   Claiming habilitado: ${stats._claimingEnabled}`);
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

  if (!stats._finalized) {
    throw new Error(
      "Las asignaciones no están finalizadas. Ejecuta primero 2-load-wl.ts"
    );
  }

  if (stats._claimingEnabled) {
    console.log("\n⚠️ El claiming ya está habilitado");
    return;
  }

  // Habilitar claiming
  console.log("\n🚀 Habilitando claiming...");
  try {
    const tx = await distributor.enableClaiming();
    console.log(`   Tx enviada: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`   ✅ Claiming habilitado en bloque ${receipt?.blockNumber}`);

    // Verificar el estado final
    const finalStats = await distributor.getStats();
    console.log("\n📊 Estado final:");
    console.log(`   Claiming habilitado: ${finalStats._claimingEnabled}`);
    console.log(
      `   Direcciones pendientes de claim: ${finalStats._pendingCount}`
    );
  } catch (error) {
    console.error("   ❌ Error al habilitar claiming:", error);
    throw error;
  }

  console.log("\n✅ Claiming activado exitosamente!");
  console.log("   Los usuarios ahora pueden reclamar sus tokens");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
