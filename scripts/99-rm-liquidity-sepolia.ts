import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

// Configuración de Base Sepolia
const BASE_SEPOLIA_CONFIG = {
  positionManager: "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2",
  rpcUrl: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
};

// ABI del NonFungiblePositionManager
const POSITION_MANAGER_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: "uint256", name: "tokenId", type: "uint256" },
          { internalType: "uint128", name: "liquidity", type: "uint128" },
          { internalType: "uint256", name: "amount0Min", type: "uint256" },
          { internalType: "uint256", name: "amount1Min", type: "uint256" },
          { internalType: "uint256", name: "deadline", type: "uint256" },
        ],
        internalType:
          "struct INonfungiblePositionManager.DecreaseLiquidityParams",
        name: "params",
        type: "tuple",
      },
    ],
    name: "decreaseLiquidity",
    outputs: [
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "uint256", name: "tokenId", type: "uint256" },
          { internalType: "address", name: "recipient", type: "address" },
          { internalType: "uint128", name: "amount0Max", type: "uint128" },
          { internalType: "uint128", name: "amount1Max", type: "uint128" },
        ],
        internalType: "struct INonfungiblePositionManager.CollectParams",
        name: "params",
        type: "tuple",
      },
    ],
    name: "collect",
    outputs: [
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "positions",
    outputs: [
      { internalType: "uint96", name: "nonce", type: "uint96" },
      { internalType: "address", name: "operator", type: "address" },
      { internalType: "address", name: "token0", type: "address" },
      { internalType: "address", name: "token1", type: "address" },
      { internalType: "uint24", name: "fee", type: "uint24" },
      { internalType: "int24", name: "tickLower", type: "int24" },
      { internalType: "int24", name: "tickUpper", type: "int24" },
      { internalType: "uint128", name: "liquidity", type: "uint128" },
      {
        internalType: "uint256",
        name: "feeGrowthInside0LastX128",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "feeGrowthInside1LastX128",
        type: "uint256",
      },
      { internalType: "uint128", name: "tokensOwed0", type: "uint128" },
      { internalType: "uint128", name: "tokensOwed1", type: "uint128" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "burn",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
];

// ABI para ERC20
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

async function main() {
  console.log("🔄 Retiro de Liquidez de Uniswap V3");
  console.log("══════════════════════════════════");

  // Verificar que tengamos el position token ID
  const positionTokenId = process.env.POSITION_TOKEN_ID;

  if (!positionTokenId) {
    console.error("❌ POSITION_TOKEN_ID no está configurado en .env");
    console.error("   Ejecuta primero el script de deploy y actualiza .env");
    process.exit(1);
  }

  console.log(`\n📊 Configuración:`);
  console.log(`   Position Token ID: ${positionTokenId}`);

  // Conectar al provider y obtener signer
  const provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_CONFIG.rpcUrl);
  const [signer] = await ethers.getSigners();

  console.log(`   Cuenta: ${signer.address}`);

  // Conectar al Position Manager
  const positionManager = new ethers.Contract(
    BASE_SEPOLIA_CONFIG.positionManager,
    POSITION_MANAGER_ABI,
    signer
  );

  // Obtener información de la posición
  console.log("\n🔍 Obteniendo información de la posición...");
  const position = await positionManager.positions(positionTokenId);

  console.log(`   Token0: ${position.token0}`);
  console.log(`   Token1: ${position.token1}`);
  console.log(`   Liquidez: ${position.liquidity}`);

  // Obtener información de los tokens
  const token0 = new ethers.Contract(position.token0, ERC20_ABI, provider);
  const token1 = new ethers.Contract(position.token1, ERC20_ABI, provider);

  const [symbol0, symbol1] = await Promise.all([
    token0.symbol(),
    token1.symbol(),
  ]);

  console.log(`   Par: ${symbol0}/${symbol1}`);

  // Verificar balances antes
  const [balance0Before, balance1Before] = await Promise.all([
    token0.balanceOf(signer.address),
    token1.balanceOf(signer.address),
  ]);

  console.log("\n💰 Balances antes:");
  console.log(`   ${symbol0}: ${ethers.formatEther(balance0Before)}`);
  console.log(`   ${symbol1}: ${ethers.formatEther(balance1Before)}`);

  // 1. Remover toda la liquidez
  console.log("\n🌊 Removiendo liquidez...");

  const decreaseLiquidityParams = {
    tokenId: positionTokenId,
    liquidity: position.liquidity,
    amount0Min: 0,
    amount1Min: 0,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutos
  };

  const decreaseTx = await positionManager.decreaseLiquidity(
    decreaseLiquidityParams
  );
  console.log(`   TX: ${decreaseTx.hash}`);
  console.log("   Esperando confirmación...");
  const decreaseReceipt = await decreaseTx.wait();
  console.log("   ✅ Liquidez removida");

  // 2. Recolectar los tokens
  console.log("\n💸 Recolectando tokens...");

  // Usar MaxUint128 en lugar de MaxUint256 para amount0Max y amount1Max
  const MAX_UINT128 = 2n ** 128n - 1n;

  const collectParams = {
    tokenId: positionTokenId,
    recipient: signer.address,
    amount0Max: MAX_UINT128,
    amount1Max: MAX_UINT128,
  };

  const collectTx = await positionManager.collect(collectParams);
  console.log(`   TX: ${collectTx.hash}`);
  console.log("   Esperando confirmación...");
  const collectReceipt = await collectTx.wait();
  console.log("   ✅ Tokens recolectados");

  // 3. Quemar el NFT de la posición (opcional)
  console.log("\n🔥 Quemando NFT de la posición...");
  try {
    const burnTx = await positionManager.burn(positionTokenId);
    console.log(`   TX: ${burnTx.hash}`);
    await burnTx.wait();
    console.log("   ✅ NFT quemado");
  } catch (error) {
    console.log(
      "   ⚠️  No se pudo quemar el NFT (puede tener fees no recolectados)"
    );
  }

  // Verificar balances después
  const [balance0After, balance1After] = await Promise.all([
    token0.balanceOf(signer.address),
    token1.balanceOf(signer.address),
  ]);

  console.log("\n💰 Balances después:");
  console.log(`   ${symbol0}: ${ethers.formatEther(balance0After)}`);
  console.log(`   ${symbol1}: ${ethers.formatEther(balance1After)}`);

  console.log("\n📊 Tokens recuperados:");
  console.log(
    `   ${symbol0}: ${ethers.formatEther(balance0After - balance0Before)}`
  );
  console.log(
    `   ${symbol1}: ${ethers.formatEther(balance1After - balance1Before)}`
  );

  console.log("\n✅ Liquidez retirada exitosamente!");
  console.log("\n⚠️  Nota: El pool sigue existiendo pero sin liquidez");
  console.log("   Puedes volver a agregar liquidez o crear un nuevo pool");

  // Sugerencia para el siguiente paso
  console.log("\n💡 Próximos pasos:");
  console.log("   1. Ajusta LIQUIDITY_ETH en .env a un valor mayor (ej: 8.5)");
  console.log("   2. Ejecuta el script de deploy nuevamente");
  console.log("   3. Valida el profit con el script de validación");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
