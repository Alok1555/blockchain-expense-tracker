require("@nomicfoundation/hardhat-toolbox");
const path = require("path");

// Settings come from a .env file in this folder or in the parent folder,
// so a single .env next to all five projects is enough. See .env.example.
require("dotenv").config({
  path: [path.join(__dirname, ".env"), path.join(__dirname, "..", ".env")],
  quiet: true,
});

const privateKey = (process.env.PRIVATE_KEY || "").trim();
const accounts = privateKey ? [privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.30",
    settings: {
      evmVersion: "osaka", // recommended by the Monad docs
      optimizer: { enabled: true, runs: 200 },
      metadata: { bytecodeHash: "ipfs" }, // needed for Sourcify verification
    },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    monadTestnet: {
      url: process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts,
    },
  },
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify-api-monad.blockvision.org",
    browserUrl: "https://testnet.monadvision.com",
  },
  etherscan: {
    enabled: false,
  },
};
