const hre = require("hardhat");

async function main() {
  const PredictionMarket = await hre.ethers.getContractFactory("PredictionMarket");

  const contract = await PredictionMarket.deploy();

  await contract.waitForDeployment();

  console.log("PredictionMarket deployed to:", await contract.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});