// Publishes the contract source on the Monad explorer (via Sourcify) so anyone
// can read the code behind the deployed address.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No deployment found for ${hre.network.name}. Run "npm run deploy:monad" first.`);
  }
  const { address, constructorArgs } = JSON.parse(fs.readFileSync(file, "utf8"));
  await hre.run("verify:verify", { address, constructorArguments: constructorArgs });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
