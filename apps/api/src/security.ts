/**
 * Cryptographic and identity primitives for the API tier.
 *
 * Everything that mints, hashes, or verifies a secret lives here so there is
 * exactly one implementation of each to audit. Route handlers call these; they
 * never reach for `node:crypto` or `jose` directly.
 *
 * The trust model these primitives implement is documented in
 * [`docs/security.md`](../../../docs/security.md). Of particular note: the room
 * ticket signed by {@link OidcSigner.signRoomTicket} is verified *again*,
 * independently, by `apps/realtime` — that duplication is the architecture, not
 * an oversight.
 *
 * @module
 */

import argon2 from "argon2";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT } from "jose";
import type { Scope, User } from "./domain.js";

/** The current time, as a single injectable seam for tests. */
export const now = () => new Date();
/** A fresh v4 UUID. Every entity id in {@link domain} comes from here. */
export const id = () => randomUUID();
/**
 * A high-entropy, URL-safe opaque token.
 *
 * 32 bytes by default — 256 bits, which is not a number anyone needs to reason
 * about further. Used for session refresh tokens and personal access tokens,
 * both of which are stored only as {@link digest} hashes.
 */
export const opaqueToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
// Excludes visually ambiguous characters (0/O, 1/I/L) since this is a code a person
// reads off one screen and types into another, not a machine-to-machine secret.
const joinCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/**
 * A shareable organization join code.
 *
 * Deliberately shorter and lower-entropy than {@link opaqueToken}: it is
 * regenerable, revocable by rotation, and only ever grants membership of one
 * workspace. Who may read or rotate it is decided by `canInviteToOrganization`
 * in {@link policy}.
 */
export const generateJoinCode = (length = 8) =>
  Array.from({ length }, () => joinCodeAlphabet[randomInt(joinCodeAlphabet.length)]).join("");
/**
 * SHA-256, hex encoded.
 *
 * Correct for hashing values that are already high-entropy — tokens, codes,
 * IP addresses. Deliberately *not* correct for passwords, which go through
 * {@link hashPassword} instead.
 */
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Generate a single-use account recovery code.
 *
 * Twelve symbols from the 31-character unambiguous alphabet is a little over 59
 * bits — far beyond guessing, while still being something a person can copy off a
 * screen and type back correctly. Formatted in groups of four purely for legibility;
 * `normalizeRecoveryCode` strips the formatting before hashing, so how the person
 * types it back does not matter.
 */
export const generateRecoveryCode = () =>
  (
    Array.from({ length: 12 }, () => joinCodeAlphabet[randomInt(joinCodeAlphabet.length)])
      .join("")
      .match(/.{4}/g) ?? []
  ).join("-");

/** Upper-cases and strips separators/whitespace so formatting never affects the hash. */
export const normalizeRecoveryCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
/**
 * The S256 PKCE code challenge for a verifier.
 *
 * PKCE is mandatory on this OIDC provider — there is no implicit grant and no
 * password grant. See [ADR 0004](../../../docs/decisions/0004-three-auth-surfaces.md).
 */
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
/**
 * Hashes a password with Argon2id.
 *
 * The cost parameters are the OWASP-recommended baseline (19 MiB, 2 iterations,
 * 1 lane). They are a deliberate latency budget on the login path, not a value
 * to tune down because registration feels slow.
 */
export const hashPassword = (value: string) =>
  argon2.hash(value, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
/** Verifies a password against an Argon2id hash. Constant-time within argon2. */
export const verifyPassword = (hash: string, value: string) => argon2.verify(hash, value);

/**
 * Projects a {@link User} to the shape safe to return in an API response.
 *
 * An allowlist rather than a redaction: a field added to `User` is absent here
 * until someone deliberately adds it, which is the failure direction you want.
 *
 * Note that this discloses `email`, `username`, and `displayName` to every
 * other member of the same workspace. That disclosure is why account recovery
 * proves possession of a {@link domain.RecoveryCode} rather than knowledge of account
 * facts — a coworker knows all three.
 */
export const publicUser = (user: User) => ({
  id: user.id,
  email: user.email,
  username: user.username,
  displayName: user.displayName,
  avatar: user.avatar,
  createdAt: user.createdAt,
  // Declared required by the published User schema. It was missing here, so every
  // response carrying a user silently violated its own documented contract.
  updatedAt: user.updatedAt,
});

/**
 * The signing identity of the first-party OpenID Connect provider.
 *
 * Holds the RSA key pair used for access tokens and ID tokens, and also signs
 * the short-lived HS256 room tickets that admit a client to the realtime tier.
 *
 * Construct it with {@link OidcSigner.create}; the constructor is private
 * because key import is asynchronous and a half-initialised signer is not a
 * useful object.
 */
export class OidcSigner {
  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly publicKey: CryptoKey,
    private readonly publicJwk: Record<string, unknown>,
    private readonly kid: string,
  ) {}

  /**
   * Builds a signer.
   *
   * With `signingJwk` (from `OIDC_PRIVATE_JWK`) the provider's identity is
   * stable across restarts and across instances, which is what production
   * requires — tokens issued by one instance must verify against another.
   *
   * Without it, an ephemeral key pair is generated. That is fine for local
   * development and deliberately useless in production: every restart
   * invalidates every token it previously issued. Boot-time validation refuses
   * that combination outright — see
   * [`docs/security.md`](../../../docs/security.md#boot-time-validation).
   *
   * @param signingJwk - An RSA private JWK. Must carry `n`, `e`, and `d`.
   * @throws If the JWK is present but is not a usable RSA private key.
   */
  static async create(signingJwk?: JsonWebKey) {
    if (signingJwk) {
      if (signingJwk.kty !== "RSA" || !signingJwk.n || !signingJwk.e || !signingJwk.d)
        throw new Error("OIDC_PRIVATE_JWK must be an RSA private JWK with n, e, and d parameters.");
      const kid = (signingJwk as JsonWebKey & { kid?: string }).kid ?? "threadline-key-1";
      const publicJwk = { kty: "RSA", n: signingJwk.n, e: signingJwk.e, kid, use: "sig", alg: "RS256" };
      const [privateKey, publicKey] = await Promise.all([
        importJWK({ ...signingJwk, kid }, "RS256"),
        importJWK(publicJwk, "RS256"),
      ]);
      return new OidcSigner(privateKey as CryptoKey, publicKey as CryptoKey, publicJwk, kid);
    }
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    return new OidcSigner(
      privateKey,
      publicKey,
      { ...jwk, kid: "threadline-dev-1", use: "sig", alg: "RS256" },
      "threadline-dev-1",
    );
  }

  /**
   * The public JWKS, as served at `/.well-known/jwks.json`.
   *
   * Only the public half is ever exposed — the private key is never exported
   * after import.
   */
  getJwks() {
    return { keys: [this.publicJwk] };
  }

  /**
   * Verifies an access token this provider issued.
   *
   * `algorithms` is pinned to RS256 rather than inferred from the token header,
   * which is what closes the algorithm-confusion attack where an attacker
   * re-signs a token as `HS256` using the public key as the HMAC secret.
   *
   * @throws If the signature, issuer, or expiry does not check out.
   */
  async verifyAccessToken(token: string, issuer: string) {
    const { payload } = await jwtVerify(token, this.publicKey, { issuer, algorithms: ["RS256"] });
    return payload;
  }

  /**
   * Signs an OAuth access token.
   *
   * Fifteen minutes by default. Short deliberately: an access token cannot be
   * revoked before it expires, so its lifetime *is* the revocation window.
   */
  async signAccessToken(input: { issuer: string; audience: string; user: User; scopes: Scope[]; expiresIn?: string }) {
    return new SignJWT({
      scope: input.scopes.join(" "),
      preferred_username: input.user.username,
      email: input.user.email,
    })
      .setProtectedHeader({ alg: "RS256", kid: this.kid, typ: "JWT" })
      .setIssuer(input.issuer)
      .setAudience(input.audience)
      .setSubject(input.user.id)
      .setIssuedAt()
      .setExpirationTime(input.expiresIn ?? "15m")
      .sign(this.privateKey);
  }

  /**
   * Signs an OIDC ID token.
   *
   * `email_verified` is passed in by the caller rather than derived here.
   * Threadline has no mail provider and therefore no verification flow, so this
   * is honest about what it actually knows — see
   * [ADR 0007](../../../docs/decisions/0007-no-email-verification-without-a-mail-provider.md).
   */
  async signIdToken(input: { issuer: string; audience: string; user: User; emailVerified: boolean; nonce?: string }) {
    const token = new SignJWT({
      email: input.user.email,
      email_verified: input.emailVerified,
      preferred_username: input.user.username,
      ...(input.nonce ? { nonce: input.nonce } : {}),
    })
      .setProtectedHeader({ alg: "RS256", kid: this.kid, typ: "JWT" })
      .setIssuer(input.issuer)
      .setAudience(input.audience)
      .setSubject(input.user.id)
      .setIssuedAt()
      .setExpirationTime("15m");
    return token.sign(this.privateKey);
  }

  /**
   * Signs a short-lived ticket admitting one user to one room's Durable Object.
   *
   * Three properties matter, and none of them are incidental:
   *
   * - **Two minutes.** Long enough to redeem immediately after an authorization
   *   decision, short enough that a leaked ticket is not a durable capability.
   * - **HS256 with a shared secret**, not the RSA key. `ROOM_TICKET_SECRET` is
   *   held by both `apps/api` (which signs) and `apps/realtime` (which
   *   verifies), and authorizes exactly this one thing.
   * - **The role travels inside the ticket.** The realtime tier reads it from
   *   the verified payload rather than from anything the client sends.
   *
   * The realtime tier verifies this ticket **independently**. It does not treat
   * the existence of a ticket as evidence that the API authorized the join —
   * that re-verification is the central claim of the architecture and must not
   * be optimized away. See [`docs/security.md`](../../../docs/security.md).
   */
  async signRoomTicket(input: { issuer: string; secret: Uint8Array; user: User; roomId: string; role: string }) {
    return new SignJWT({
      room_id: input.roomId,
      role: input.role,
      username: input.user.username,
      display_name: input.user.displayName,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(input.issuer)
      .setSubject(input.user.id)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(input.secret);
  }
}
