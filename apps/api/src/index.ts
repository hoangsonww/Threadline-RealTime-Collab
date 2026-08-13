import "./instrument.js";
import express from "express";
import { createApp } from "./application.js";
import { MemoryRepository, MongoRepository, type Repository } from "./repository.js";
import { OidcSigner } from "./security.js";

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

type IceServer = { urls: string | string[]; username?: string; credential?: string };

function createIceServerProvider() {
  const keyId = process.env.TURN_KEY_ID;
  const apiToken = process.env.TURN_KEY_API_TOKEN;
  if (!keyId && !apiToken) return undefined;
  if (!keyId || !apiToken) throw new Error("TURN_KEY_ID and TURN_KEY_API_TOKEN must be configured together.");

  return async (): Promise<IceServer[]> => {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: 86_400 }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) throw new Error(`TURN credential generation failed with status ${response.status}.`);
    const payload = (await response.json()) as { iceServers?: unknown };
    if (!Array.isArray(payload.iceServers)) throw new Error("TURN credential response did not include ICE servers.");

    const servers = payload.iceServers.flatMap((entry): IceServer[] => {
      if (!entry || typeof entry !== "object" || !("urls" in entry)) return [];
      const candidate = entry as { urls: unknown; username?: unknown; credential?: unknown };
      const rawUrls = typeof candidate.urls === "string" ? [candidate.urls] : candidate.urls;
      if (!Array.isArray(rawUrls) || !rawUrls.every((url) => typeof url === "string")) return [];
      // Browsers block alternate port 53 and otherwise wait for it to time out.
      const urls = rawUrls.filter((url) => !url.includes(":53"));
      if (!urls.length) return [];
      return [
        {
          urls,
          ...(typeof candidate.username === "string" ? { username: candidate.username } : {}),
          ...(typeof candidate.credential === "string" ? { credential: candidate.credential } : {}),
        },
      ];
    });
    if (!servers.length) throw new Error("TURN credential response contained no browser-compatible ICE servers.");
    return servers;
  };
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
  const actionBaseUrl = (process.env.AUTH_ACTION_ORIGIN ?? webOrigin).replace(/\/$/, "");
  const deliveryWebhook = process.env.AUTH_DELIVERY_WEBHOOK;
  const actionDeliverySecret = process.env.AUTH_DELIVERY_SECRET;
  if (deliveryWebhook && !actionDeliverySecret)
    throw new Error("AUTH_DELIVERY_SECRET is required when AUTH_DELIVERY_WEBHOOK is configured.");
  const signer = await OidcSigner.create(parseSigningJwk());
  return createApp(
    {
      repository,
      issuer,
      webOrigin,
      additionalWebOrigins,
      secureCookies: isProduction || process.env.COOKIE_SECURE === "true",
      ticketSecret: secret("ROOM_TICKET_SECRET", "development-ticket-secret-change-me"),
      ingestSecret: secret("INTERNAL_INGEST_SECRET", "development-ingest-secret-change-me"),
      signer,
      getIceServers: createIceServerProvider(),
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
