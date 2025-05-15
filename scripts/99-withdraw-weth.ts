// scripts/withdraw-weth.ts
import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

// WETH address en Base
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";

// ABI mínimo para WETH
const WETH_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function withdraw(uint256 wad)",
  "function deposit() payable",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

async function main() {
  const [signer] = await ethers.getSigners();

  console.log("🔄 Retirando WETH a ETH");
  console.log("📍 Wallet:", signer.address);

  // Conectar al contrato WETH
  const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);

  // Obtener balance de WETH
  const wethBalance = await weth.balanceOf(signer.address);
  console.log(`\n💰 Balance WETH: ${ethers.formatEther(wethBalance)} WETH`);

  if (wethBalance === 0n) {
    console.log("❌ No tienes WETH para retirar");
    return;
  }

  // Obtener balance de ETH actual
  const ethBalanceBefore = await ethers.provider.getBalance(signer.address);
  console.log(
    `💵 Balance ETH actual: ${ethers.formatEther(ethBalanceBefore)} ETH`
  );

  // Procesar cantidad a retirar
  let amountToWithdraw = wethBalance;

  // Si se proporciona un argumento, usarlo como cantidad
  const amountArg = process.argv[2];
  if (amountArg) {
    if (amountArg.toLowerCase() === "all") {
      amountToWithdraw = wethBalance;
    } else {
      amountToWithdraw = ethers.parseEther(amountArg);
      if (amountToWithdraw > wethBalance) {
        console.log("❌ La cantidad especificada excede tu balance de WETH");
        return;
      }
    }
  }

  console.log(`\n🎯 Retirando: ${ethers.formatEther(amountToWithdraw)} WETH`);

  try {
    // Ejecutar withdraw
    console.log("📤 Enviando transacción...");
    const tx = await weth.withdraw(amountToWithdraw);
    console.log(`   Tx hash: ${tx.hash}`);

    // Esperar confirmación
    console.log("⏳ Esperando confirmación...");
    const receipt = await tx.wait();
    console.log(`✅ Confirmado en bloque: ${receipt?.blockNumber}`);

    // Verificar balances finales
    const wethBalanceAfter = await weth.balanceOf(signer.address);
    const ethBalanceAfter = await ethers.provider.getBalance(signer.address);

    console.log("\n📊 Balances finales:");
    console.log(
      `   WETH: ${ethers.formatEther(wethBalanceAfter)} (${ethers.formatEther(
        wethBalance - wethBalanceAfter
      )} retirado)`
    );
    console.log(`   ETH: ${ethers.formatEther(ethBalanceAfter)}`);

    // Calcular ETH recibido (considerando gas)
    const gasUsed = receipt?.gasUsed || 0n;
    const gasPrice = receipt?.gasPrice || 0n;
    const gasCost = gasUsed * gasPrice;
    const ethReceived = ethBalanceAfter - ethBalanceBefore;

    console.log(`\n💸 ETH recibido: ${ethers.formatEther(ethReceived)}`);
    console.log(`   Gas utilizado: ${ethers.formatEther(gasCost)} ETH`);
  } catch (error: any) {
    console.error("❌ Error retirando WETH:", error.message);

    // Si el error es por falta de gas o balance
    if (error.message.includes("insufficient funds")) {
      console.log("\n💡 Tip: Asegúrate de tener suficiente ETH para el gas");
    }
  }
}

// Uso:
// npx hardhat run scripts/withdraw-weth.ts --network base
// npx hardhat run scripts/withdraw-weth.ts --network base -- 1.5
// npx hardhat run scripts/withdraw-weth.ts --network base -- all

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
