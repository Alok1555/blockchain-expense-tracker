const hre = require("hardhat");
const { NETWORKS, saveDeployment } = require("./frontend-config");

const CONTRACT_NAME = "ExpenseTracker";

async function main() {
  const constructorArgs = [];
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer wallet. Copy .env.example to .env and set PRIVATE_KEY.");
  }

  const network = NETWORKS[hre.network.name];
  const currency = network ? network.currency : "ETH";
  const { chainId } = await hre.ethers.provider.getNetwork();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log(`Network:  ${hre.network.name} (chain ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} ${currency}`);
  if (balance === 0n) {
    const faucet = network && network.faucet ? ` Get free testnet ${currency} at ${network.faucet}` : "";
    throw new Error(`The deployer wallet has no ${currency} to pay for gas.${faucet}`);
  }

  console.log(`\nDeploying ${CONTRACT_NAME}...`);
  const contract = await hre.ethers.deployContract(CONTRACT_NAME, constructorArgs);
  const tx = contract.deploymentTransaction();
  console.log(`Transaction: ${tx.hash}`);
  const receipt = await tx.wait();
  const address = await contract.getAddress();

  console.log(`\n${CONTRACT_NAME} deployed to ${address} (block ${receipt.blockNumber})`);
  if (network && network.explorer) {
    console.log(`Explorer: ${network.explorer}/address/${address}`);
  }

  saveDeployment(hre, CONTRACT_NAME, {
    address,
    deployer: deployer.address,
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber,
    constructorArgs,
    deployedAt: new Date().toISOString(),
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
