import "dotenv/config";
import { createApp } from "./app";
import { MemoryRepository, MongoRepository, type Repository } from "./repository";
import { OidcSigner } from "./security";

const isProduction = process.env.NODE_ENV === "production";

function required(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value && isProduction) throw new Error(`${name} is required in production.`);
  return value ?? "";
}

function secret(name: string, fallback: string) {
  const value = required(name, isProduction ? undefined : fallback);
  if (isProduction && value.length < 32) throw new Error(`${name} must be at least 32 characters long in production.`);
  return value;
}

function parseSigningJwk() {
  const encoded = process.env.OIDC_PRIVATE_JWK;
  if (!encoded) {
    if (isProduction) throw new Error("OIDC_PRIVATE_JWK is required in production so signed tokens survive restarts.");
    return undefined;
  }
  try {
    return JSON.parse(encoded) as JsonWebKey;
  } catch {
    throw new Error("OIDC_PRIVATE_JWK must be valid JSON containing an RSA private JWK.");
  }
}

async function start() {
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port.");
  const issuer = required("OIDC_ISSUER", `http://localhost:${port}`).replace(/\/$/, "");
  const webOrigin = required("WEB_ORIGIN", "http://localhost:3000").replace(/\/$/, "");
  if (isProduction && (!issuer.startsWith("https://") || !webOrigin.startsWith("https://")))
    throw new Error("OIDC_ISSUER and WEB_ORIGIN must use HTTPS in production.");
  const repository: Repository = process.env.MONGODB_URI
    ? await MongoRepository.connect(process.env.MONGODB_URI, `${webOrigin}/oidc/callback`)
    : isProduction
      ? (() => {
          throw new Error("MONGODB_URI is required in production.");
        })()
      : new MemoryRepository();
  const actionBaseUrl = (process.env.AUTH_ACTION_ORIGIN ?? webOrigin).replace(/\/$/, "");
  const deliveryWebhook = process.env.AUTH_DELIVERY_WEBHOOK;
  if (isProduction && !deliveryWebhook)
    throw new Error(
      "AUTH_DELIVERY_WEBHOOK is required in production to deliver password recovery and verification links.",
    );
  const actionDeliverySecret = process.env.AUTH_DELIVERY_SECRET;
  if (isProduction && deliveryWebhook && !actionDeliverySecret)
    throw new Error("AUTH_DELIVERY_SECRET is required when AUTH_DELIVERY_WEBHOOK is configured in production.");
  const signer = await OidcSigner.create(parseSigningJwk());
  const app = createApp({
    repository,
    issuer,
    webOrigin,
    secureCookies: isProduction || process.env.COOKIE_SECURE === "true",
    ticketSecret: secret("ROOM_TICKET_SECRET", "development-ticket-secret-change-me"),
    ingestSecret: secret("INTERNAL_INGEST_SECRET", "development-ingest-secret-change-me"),
    signer,
    actionUrl: (type, token) =>
      `${actionBaseUrl}/${type === "password_reset" ? "reset-password" : "verify-email"}?token=${encodeURIComponent(token)}`,
    deliverAccountAction: deliveryWebhook
      ? async (input) => {
          try {
            const result = await fetch(deliveryWebhook, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(actionDeliverySecret ? { "x-threadline-delivery": actionDeliverySecret } : {}),
              },
              body: JSON.stringify(input),
            });
            if (!result.ok) console.error(`Account action delivery failed with status ${result.status}.`);
          } catch (error) {
            console.error("Account action delivery request failed.", error);
          }
        }
      : undefined,
  });
  app.listen(port, () => console.log(`Threadline API listening at ${issuer}`));
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
