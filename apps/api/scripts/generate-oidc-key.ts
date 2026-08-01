import { exportJWK, generateKeyPair } from "jose";

async function generate() {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  console.log(JSON.stringify({ ...jwk, kid: "threadline-key-1", use: "sig", alg: "RS256" }));
}

generate().catch((error) => {
  console.error(error);
  process.exit(1);
});
