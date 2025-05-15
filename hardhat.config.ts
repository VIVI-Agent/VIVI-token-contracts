import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true, // Habilita el IR
        },
      },
    ],
  },
  networks: {
    base: {
      url: "https://mainnet.base.org",
      accounts: [PRIVATE_KEY as string],
    },
    "base-sepolia": {
      url: "https://sepolia.base.org",
      accounts: [PRIVATE_KEY as string],
      chainId: 84532, // Chain ID de Base Sepolia
    },
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY as string,
      "base-sepolia": process.env.BASESCAN_API_KEY as string, // Usa la misma API key
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
};

export default config;
