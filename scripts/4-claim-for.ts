// scripts/claim-for-user.ts
import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const distributorAddress = process.env.DISTRIBUTOR_ADDRESS;
  if (!distributorAddress) {
    throw new Error("DISTRIBUTOR_ADDRESS no encontrada en .env.local");
  }

  // Obtener la dirección del usuario desde argumentos de línea de comandos
  const userAddress = process.argv[2];
  if (!userAddress || !ethers.isAddress(userAddress)) {
    throw new Error(
      "Por favor proporciona una dirección válida como argumento: npm run claim-for 0x..."
    );
  }

  console.log(`🎯 Ejecutando claim para el usuario: ${userAddress}`);
  console.log(`📍 Distribuidor: ${distributorAddress}\n`);

  const [signer] = await ethers.getSigners();
  const distributor = await ethers.getContractAt(
    "TokenDistributor",
    distributorAddress
  );

  // Verificar que el signer es el owner
  const owner = await distributor.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Solo el owner puede ejecutar esta función. Owner actual: ${owner}`
    );
  }

  // Obtener información del usuario
  const userInfo = await distributor.getUserInfo(userAddress);

  console.log("📊 Información del usuario:");
  console.log(
    `   Allocation: ${ethers.formatEther(userInfo.allocation)} tokens`
  );
  console.log(`   Ya reclamó: ${userInfo.claimed}`);
  console.log(
    `   Tipo de distribución: ${userInfo.distType === 0n ? "CLAIM" : "AIRDROP"}`
  );
  console.log(`   Puede reclamar: ${userInfo.canClaim}`);

  // Verificar el estado del claiming
  const stats = await distributor.getStats();
  console.log("\n📊 Estado del distribuidor:");
  console.log(`   Claiming habilitado: ${stats._claimingEnabled}`);
  console.log(
    `   Total asignado: ${ethers.formatEther(stats._totalAllocated)} tokens`
  );
  console.log(
    `   Total distribuido: ${ethers.formatEther(
      stats._totalDistributed
    )} tokens`
  );

  // Validaciones
  if (!stats._claimingEnabled) {
    throw new Error("El claiming no está habilitado");
  }

  if (userInfo.allocation === 0n) {
    throw new Error("El usuario no tiene allocation");
  }

  if (userInfo.claimed) {
    throw new Error("El usuario ya reclamó sus tokens");
  }

  if (userInfo.distType !== 0n) {
    // 0 = CLAIM, 1 = AIRDROP
    throw new Error("El usuario está marcado para airdrop, no para claim");
  }

  // Ejecutar claimFor
  console.log(`\n🚀 Ejecutando claim para ${userAddress}...`);
  console.log(`   Cantidad: ${ethers.formatEther(userInfo.allocation)} tokens`);

  try {
    const tx = await distributor.claimFor(userAddress);
    console.log(`   Tx enviada: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`   ✅ Claim ejecutado en bloque ${receipt?.blockNumber}`);

    // Buscar evento en los logs
    if (receipt?.logs) {
      for (const log of receipt.logs) {
        try {
          const parsedLog = distributor.interface.parseLog(log);
          if (
            parsedLog?.name === "TokensClaimed" &&
            parsedLog.args.user.toLowerCase() === userAddress.toLowerCase()
          ) {
            console.log(
              `   ✓ Tokens reclamados: ${ethers.formatEther(
                parsedLog.args.amount
              )}`
            );
          }
        } catch (e) {
          // Ignorar logs que no son del contrato
        }
      }
    }

    // Verificar estado final del usuario
    const finalUserInfo = await distributor.getUserInfo(userAddress);
    console.log("\n📊 Estado final del usuario:");
    console.log(`   Ya reclamó: ${finalUserInfo.claimed}`);
  } catch (error: any) {
    console.error(`   ❌ Error ejecutando claim:`, error.message);
    throw error;
  }

  console.log("\n✅ Claim ejecutado exitosamente!");
}

// Ejecutar con: npx hardhat run scripts/claim-for-user.ts --network [network] -- 0x...
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
