import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import { ethers } from "hardhat";

interface Holder {
  HolderAddress: string;
  Balance: string;
  PendingBalanceUpdate: string;
}

interface Distribution {
  address: string;
  tokens: string;
  type?: string;
}

async function main() {
  console.log("🔍 Validando distribución vs holders actuales...\n");

  // Leer archivos
  const holdersFile = path.join(
    __dirname,
    "export-tokenholders-for-contract-0xb64d5316FD9c2963086C5BA90bAab54d69b75268.csv"
  );
  const claimFile = path.join(__dirname, "test_claim_distribution.csv");
  const airdropFile = path.join(__dirname, "test_airdrop_distribution.csv");

  const holdersCsv = fs.readFileSync(holdersFile, "utf-8");
  const claimCsv = fs.readFileSync(claimFile, "utf-8");
  const airdropCsv = fs.readFileSync(airdropFile, "utf-8");

  const holders: Holder[] = parse(holdersCsv, {
    columns: true,
    skip_empty_lines: true,
  });
  const claimDist: Distribution[] = parse(claimCsv, {
    columns: true,
    skip_empty_lines: true,
  });
  const airdropDist: Distribution[] = parse(airdropCsv, {
    columns: true,
    skip_empty_lines: true,
  });

  console.log(`📊 Datos cargados:`);
  console.log(`   Holders actuales: ${holders.length}`);
  console.log(`   Distribución claim: ${claimDist.length}`);
  console.log(`   Distribución airdrop: ${airdropDist.length}`);

  // Crear mapa de distribución esperada
  const expectedDistribution = new Map<string, bigint>();

  // Agregar claim
  for (const claim of claimDist) {
    expectedDistribution.set(claim.address.toLowerCase(), BigInt(claim.tokens));
  }

  // Agregar airdrop
  for (const airdrop of airdropDist) {
    expectedDistribution.set(
      airdrop.address.toLowerCase(),
      BigInt(airdrop.tokens)
    );
  }

  // Crear mapa de holders actuales
  const actualHolders = new Map<string, bigint>();
  let totalHolderBalance = 0n;

  for (const holder of holders) {
    const balance = ethers.parseEther(holder.Balance);
    actualHolders.set(holder.HolderAddress.toLowerCase(), balance);
    totalHolderBalance += balance;
  }

  // Comparar distribuciones
  const discrepancies: any[] = [];
  const missingHolders: string[] = [];
  const unexpectedHolders: string[] = [];
  const matchingHolders: any[] = [];

  // Verificar cada dirección esperada
  for (const [address, expectedTokens] of expectedDistribution) {
    const expectedWithDecimals = expectedTokens * 10n ** 18n;
    const actualBalance = actualHolders.get(address);

    if (actualBalance === undefined) {
      missingHolders.push(address);
    } else if (actualBalance !== expectedWithDecimals) {
      discrepancies.push({
        address,
        expected: ethers.formatEther(expectedWithDecimals),
        actual: ethers.formatEther(actualBalance),
        difference: ethers.formatEther(actualBalance - expectedWithDecimals),
      });
    } else {
      matchingHolders.push({
        address,
        balance: ethers.formatEther(actualBalance),
      });
    }
  }

  // Verificar holders no esperados
  for (const [address, balance] of actualHolders) {
    if (!expectedDistribution.has(address)) {
      unexpectedHolders.push(address);
    }
  }

  // Mostrar resultados
  console.log("\n✅ Coincidencias correctas:");
  console.log(`   ${matchingHolders.length} direcciones con balance correcto`);

  if (discrepancies.length > 0) {
    console.log("\n⚠️ Discrepancias encontradas:");
    for (const disc of discrepancies) {
      console.log(`   ${disc.address}:`);
      console.log(`      Esperado: ${disc.expected} tokens`);
      console.log(`      Actual: ${disc.actual} tokens`);
      console.log(`      Diferencia: ${disc.difference} tokens`);
    }
  }

  if (missingHolders.length > 0) {
    console.log("\n❌ Direcciones faltantes (esperadas pero no encontradas):");
    for (const address of missingHolders) {
      const expected = expectedDistribution.get(address)!;
      console.log(`   ${address}: ${expected} tokens esperados`);
    }
  }

  if (unexpectedHolders.length > 0) {
    console.log("\n🔍 Holders no esperados:");
    for (const address of unexpectedHolders) {
      const balance = actualHolders.get(address)!;
      console.log(`   ${address}: ${ethers.formatEther(balance)} tokens`);
    }
  }

  // Resumen de totales
  const expectedTotal =
    Array.from(expectedDistribution.values()).reduce(
      (sum, val) => sum + val,
      0n
    ) *
    10n ** 18n;

  console.log("\n📈 Resumen de totales:");
  console.log(`   Total esperado: ${ethers.formatEther(expectedTotal)} tokens`);
  console.log(
    `   Total actual: ${ethers.formatEther(totalHolderBalance)} tokens`
  );
  console.log(
    `   Diferencia: ${ethers.formatEther(
      totalHolderBalance - expectedTotal
    )} tokens`
  );

  // Análisis por tipo
  const claimAddresses = new Set(claimDist.map((c) => c.address.toLowerCase()));
  const airdropAddresses = new Set(
    airdropDist.map((a) => a.address.toLowerCase())
  );

  let claimTotal = 0n;
  let airdropTotal = 0n;
  let claimHolders = 0;
  let airdropHolders = 0;

  for (const [address, balance] of actualHolders) {
    if (claimAddresses.has(address)) {
      claimTotal += balance;
      claimHolders++;
    } else if (airdropAddresses.has(address)) {
      airdropTotal += balance;
      airdropHolders++;
    }
  }

  console.log("\n📊 Análisis por tipo:");
  console.log(`   Claim holders: ${claimHolders}/${claimDist.length}`);
  console.log(`   Claim total: ${ethers.formatEther(claimTotal)} tokens`);
  console.log(`   Airdrop holders: ${airdropHolders}/${airdropDist.length}`);
  console.log(`   Airdrop total: ${ethers.formatEther(airdropTotal)} tokens`);

  // Validación final
  const isValid =
    discrepancies.length === 0 &&
    missingHolders.length === 0 &&
    totalHolderBalance === expectedTotal;

  console.log("\n🏁 Resultado de validación:");
  console.log(
    isValid
      ? "   ✅ VÁLIDO - La distribución coincide perfectamente"
      : "   ❌ INVÁLIDO - Hay discrepancias en la distribución"
  );

  // Guardar reporte
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalHolders: holders.length,
      expectedDistributions: expectedDistribution.size,
      matchingHolders: matchingHolders.length,
      discrepancies: discrepancies.length,
      missingHolders: missingHolders.length,
      unexpectedHolders: unexpectedHolders.length,
      isValid,
    },
    totals: {
      expected: ethers.formatEther(expectedTotal),
      actual: ethers.formatEther(totalHolderBalance),
      difference: ethers.formatEther(totalHolderBalance - expectedTotal),
    },
    discrepancies,
    missingHolders,
    unexpectedHolders,
  };

  fs.writeFileSync(
    path.join(__dirname, "validation-report.json"),
    JSON.stringify(report, null, 2)
  );

  console.log("\n📄 Reporte guardado en validation-report.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
