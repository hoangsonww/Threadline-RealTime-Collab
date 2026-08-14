import argon2 from "argon2";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT } from "jose";
import type { Scope, User } from "./domain.js";

export const now = () => new Date();
export const id = () => randomUUID();
export const opaqueToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
// Excludes visually ambiguous characters (0/O, 1/I/L) since this is a code a person
// reads off one screen and types into another, not a machine-to-machine secret.
const joinCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const generateJoinCode = (length = 8) =>
  Array.from({ length }, () => joinCodeAlphabet[randomInt(joinCodeAlphabet.length)]).join("");
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
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
export const hashPassword = (value: string) =>
  argon2.hash(value, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (hash: string, value: string) => argon2.verify(hash, value);

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

export class OidcSigner {
  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly publicKey: CryptoKey,
    private readonly publicJwk: Record<string, unknown>,
    private readonly kid: string,
  ) {}

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

  getJwks() {
    return { keys: [this.publicJwk] };
  }

  async verifyAccessToken(token: string, issuer: string) {
    const { payload } = await jwtVerify(token, this.publicKey, { issuer, algorithms: ["RS256"] });
    return payload;
  }

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
