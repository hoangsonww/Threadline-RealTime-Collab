// Writes the OpenAPI specification to stdout, or to a file with `--out`.
//
//   npm run openapi --workspace=@threadline/api            → stdout
//   npm run openapi --workspace=@threadline/api -- --out openapi.json
//
// The document is built from the same `createOpenApiDocument` the running
// service serves, so an exported file cannot describe a different API from the
// live one. `serverUrl` and `issuer` are the only inputs, and both default to
// the local development origins rather than to a deployment.

import { writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { createOpenApiDocument } from "../src/openapi.js";

const args = process.argv.slice(2);
const valueOf = (flag: string, fallback: string) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};

const serverUrl = valueOf("--server", process.env.OPENAPI_SERVER_URL ?? "http://localhost:4000");
const issuer = valueOf("--issuer", process.env.OIDC_ISSUER ?? "http://localhost:4000");
const out = valueOf("--out", "");

const document = createOpenApiDocument({ serverUrl, issuer });
const json = `${JSON.stringify(document, null, 2)}\n`;

if (out) {
  // `npm run --workspace` runs with the workspace as the cwd, so a relative
  // `--out` would land in apps/api rather than where the command was typed.
  // npm sets INIT_CWD to the original directory; fall back to cwd when the
  // script is invoked directly rather than through npm.
  const target = isAbsolute(out) ? out : resolve(process.env.INIT_CWD ?? process.cwd(), out);
  writeFileSync(target, json);
  process.stderr.write(`Wrote ${target} (server ${serverUrl}, issuer ${issuer})\n`);
} else {
  process.stdout.write(json);
}
