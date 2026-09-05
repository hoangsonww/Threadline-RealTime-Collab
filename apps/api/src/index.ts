import "./instrument.js";
import express from "express";
import { createApp } from "./application.js";
import { createRedisCache } from "./cache.js";
import { MemoryRepository, MongoRepository, type Repository } from "./repository.js";
import { OidcSigner } from "./security.js";
import { createIceServerProvider } from "./turn.js";

// Vercel executes Preview Functions with a production Node runtime. Treat
// previews as pre-production so they can exercise Atlas and the API from a
// local client without inheriting production-only delivery requirements.
const isProduction = process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview";

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

function parseOrigin(value: string, name: string) {
  try {
    const origin = new URL(value).origin;
    if (origin !== value) throw new Error("origin must not include a path");
    return origin;
  } catch {
    throw new Error(`${name} must be an absolute origin without a path.`);
  }
}

function parseAdditionalOrigins() {
  return (process.env.ADDITIONAL_WEB_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => parseOrigin(value, "ADDITIONAL_WEB_ORIGINS"));
}

function isLoopbackHttpOrigin(origin: string) {
  const url = new URL(origin);
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

async function createConfiguredApp() {
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port.");
  const issuer = parseOrigin(required("OIDC_ISSUER", `http://localhost:${port}`).replace(/\/$/, ""), "OIDC_ISSUER");
  const webOrigin = parseOrigin(required("WEB_ORIGIN", "http://localhost:3000").replace(/\/$/, ""), "WEB_ORIGIN");
  const additionalWebOrigins = parseAdditionalOrigins();
  if (isProduction && (!issuer.startsWith("https://") || !webOrigin.startsWith("https://")))
    throw new Error("OIDC_ISSUER and WEB_ORIGIN must use HTTPS in production.");
  if (
    isProduction &&
    additionalWebOrigins.some((origin) => !origin.startsWith("https://") && !isLoopbackHttpOrigin(origin))
  )
    throw new Error("ADDITIONAL_WEB_ORIGINS may only contain HTTPS origins or loopback HTTP origins in production.");
  const repository: Repository = process.env.MONGODB_URI
    ? await MongoRepository.connect(process.env.MONGODB_URI, `${webOrigin}/oidc/callback`)
    : isProduction
      ? (() => {
          throw new Error("MONGODB_URI is required in production.");
        })()
      : new MemoryRepository();
  // Optional everywhere, including production, and deliberately not awaited on
  // the network: `createRedisCache` returns a cache that reports itself
  // unavailable until the socket is ready, so an unreachable Redis costs the
  // fallback path rather than the boot. Every caller of it already has a working
  // path through the repository.
  const cache = process.env.REDIS_URL
    ? createRedisCache(process.env.REDIS_URL, { keyPrefix: process.env.REDIS_KEY_PREFIX })
    : undefined;
  const actionBaseUrl = (process.env.AUTH_ACTION_ORIGIN ?? webOrigin).replace(/\/$/, "");
  const deliveryWebhook = process.env.AUTH_DELIVERY_WEBHOOK;
  const actionDeliverySecret = process.env.AUTH_DELIVERY_SECRET;
  if (deliveryWebhook && !actionDeliverySecret)
    throw new Error("AUTH_DELIVERY_SECRET is required when AUTH_DELIVERY_WEBHOOK is configured.");
  const signer = await OidcSigner.create(parseSigningJwk());
  return createApp(
    {
      repository,
      cache,
      issuer,
      webOrigin,
      additionalWebOrigins,
      secureCookies: isProduction || process.env.COOKIE_SECURE === "true",
      ticketSecret: secret("ROOM_TICKET_SECRET", "development-ticket-secret-change-me"),
      ingestSecret: secret("INTERNAL_INGEST_SECRET", "development-ingest-secret-change-me"),
      signer,
      getIceServers: createIceServerProvider(),
      actionUrl: (_type, token) => `${actionBaseUrl}/reset-password?token=${encodeURIComponent(token)}`,
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
    },
    express(),
  );
}

const app = await createConfiguredApp();

// Vercel imports the default Express instance and owns the HTTP listener.
// Native Node, Docker, and Kubernetes still start the listener themselves.
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, () => console.log(`Threadline API listening on port ${port}`));
}

export default app;
