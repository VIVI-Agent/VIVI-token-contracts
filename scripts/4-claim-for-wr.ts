// scripts/claim-for-user-with-recipient.ts
import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

// Configuración de ejemplo - cambiar según necesidad
const userAddress = "0x459e213D8B5E79d706aB22b945e3aF983d51BC4C"; // Wallet original
const recipientAddress = "0x2FF390f8B9534D296113aD6D00727A8c939001a3"; // Nueva wallet que recibirá los tokens

async function main() {
  const distributorAddress = process.env.DISTRIBUTOR_ADDRESS;
  if (!distributorAddress) {
    throw new Error("DISTRIBUTOR_ADDRESS not found in .env");
  }

  // Obtener direcciones desde argumentos o usar las predefinidas
  const originalUser = userAddress;
  const newRecipient = recipientAddress;

  // Validar direcciones
  if (!ethers.isAddress(originalUser)) {
    throw new Error(
      "Please provide a valid original user address as first argument"
    );
  }

  if (!ethers.isAddress(newRecipient)) {
    throw new Error(
      "Please provide a valid recipient address as second argument"
    );
  }

  if (newRecipient === ethers.ZeroAddress) {
    throw new Error("Recipient cannot be zero address");
  }

  console.log(`🎯 Executing claim for lost wallet recovery`);
  console.log(`📍 Distributor: ${distributorAddress}`);
  console.log(`👤 Original wallet: ${originalUser}`);
  console.log(`📬 New recipient: ${newRecipient}\n`);

  const [signer] = await ethers.getSigners();
  const distributor = await ethers.getContractAt(
    "VIVIDistro",
    distributorAddress
  );

  // Verify signer is owner
  const owner = await distributor.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Only owner can execute this function. Current owner: ${owner}`
    );
  }

  // Get user information
  const userInfo = await distributor.getUserInfo(originalUser);

  console.log("📊 Original user information:");
  console.log(
    `   Allocation: ${ethers.formatEther(userInfo.allocation)} tokens`
  );
  console.log(`   Already claimed: ${userInfo.claimed}`);
  console.log(
    `   Distribution type: ${userInfo.distType === 0n ? "CLAIM" : "AIRDROP"}`
  );
  console.log(`   Can claim: ${userInfo.canClaim}`);

  // Get distributor stats
  const stats = await distributor.getStats();
  console.log("\n📊 Distributor state:");
  console.log(`   Claiming enabled: ${stats._claimingEnabled}`);
  console.log(
    `   Total allocated: ${ethers.formatEther(stats._totalAllocated)} tokens`
  );
  console.log(
    `   Total distributed: ${ethers.formatEther(
      stats._totalDistributed
    )} tokens`
  );

  // Validations
  if (userInfo.allocation === 0n) {
    throw new Error("User has no allocation");
  }

  if (userInfo.claimed) {
    throw new Error("User has already claimed their tokens");
  }

  if (userInfo.distType !== 0n) {
    // 0 = CLAIM, 1 = AIRDROP
    throw new Error("User is marked for airdrop, not for claim");
  }

  // Optional: Check if claiming is enabled (can be commented out for emergency)
  if (!stats._claimingEnabled) {
    console.log("⚠️  Warning: Claiming is not enabled, proceeding anyway...");
  }

  // Execute claimForWithRecipient
  console.log(`\n🚀 Executing claim for ${originalUser} to ${newRecipient}...`);
  console.log(`   Amount: ${ethers.formatEther(userInfo.allocation)} tokens`);

  try {
    const tx = await distributor.claimForWithRecipient(
      originalUser,
      newRecipient
    );
    console.log(`   Tx sent: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`   ✅ Claim executed in block ${receipt?.blockNumber}`);

    // Look for event in logs
    if (receipt?.logs) {
      for (const log of receipt.logs) {
        try {
          const parsedLog = distributor.interface.parseLog(log);
          if (parsedLog?.name === "TokensClaimedToRecipient") {
            console.log("\n📋 Event details:");
            console.log(`   Original user: ${parsedLog.args.originalUser}`);
            console.log(`   Recipient: ${parsedLog.args.recipient}`);
            console.log(
              `   Tokens transferred: ${ethers.formatEther(
                parsedLog.args.amount
              )}`
            );
          }
        } catch (e) {
          // Ignore logs not from this contract
        }
      }
    }

    // Verify final user state
    const finalUserInfo = await distributor.getUserInfo(originalUser);
    console.log("\n📊 Final state of original user:");
    console.log(`   Marked as claimed: ${finalUserInfo.claimed}`);

    // Check recipient balance
    const token = await ethers.getContractAt(
      "IERC20",
      await distributor.token()
    );
    const recipientBalance = await token.balanceOf(newRecipient);
    console.log(
      `\n💰 Recipient balance: ${ethers.formatEther(recipientBalance)} tokens`
    );
  } catch (error: any) {
    console.error(`   ❌ Error executing claim:`, error.message);
    throw error;
  }

  console.log("\n✅ Claim to alternative recipient executed successfully!");
  console.log(`   Original address ${originalUser} marked as claimed`);
  console.log(`   Tokens sent to ${newRecipient}`);
}

// Execute with:
// npx hardhat run scripts/claim-for-user-with-recipient.ts --network mainnet 0xOriginal 0xRecipient
// or
// npm run claim-lost-wallet 0xOriginal 0xRecipient
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
