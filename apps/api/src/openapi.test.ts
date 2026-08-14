import { describe, expect, it } from "vitest";
import { createOpenApiDocument } from "./openapi.js";

type Json = Record<string, unknown>;

const document = () =>
  createOpenApiDocument({ serverUrl: "https://api.threadline.test", issuer: "https://id.threadline.test" }) as Json & {
    paths: Record<string, Record<string, { operationId?: string }>>;
    components: { schemas: Record<string, unknown> };
  };

const collectRefs = (node: unknown, found = new Set<string>()) => {
  if (!node || typeof node !== "object") return found;
  const ref = (node as { $ref?: unknown }).$ref;
  if (typeof ref === "string") found.add(ref);
  for (const value of Object.values(node)) collectRefs(value, found);
  return found;
};

describe("the published OpenAPI document", () => {
  it("resolves every $ref and declares no schema nothing points at", () => {
    const doc = document();
    const schemas = Object.keys(doc.components.schemas);
    const refs = collectRefs(doc);

    const unresolved = [...refs].filter((ref) => !schemas.includes(ref.replace("#/components/schemas/", "")));
    expect(unresolved).toEqual([]);

    // An orphaned schema is the usual residue of deleting an operation and
    // forgetting its request body — it keeps the published contract describing
    // shapes the API no longer accepts.
    const orphans = schemas.filter((name) => !refs.has(`#/components/schemas/${name}`));
    expect(orphans).toEqual([]);
  });

  it("gives every operation a unique operationId", () => {
    const doc = document();
    const ids = Object.values(doc.paths)
      .flatMap((methods) => Object.values(methods).map((operation) => operation.operationId))
      .filter((id): id is string => Boolean(id));
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it("documents the profile endpoint and no email verification flow", () => {
    const doc = document();
    expect(Object.keys(doc.paths["/v1/auth/me"]).sort()).toEqual(["get", "patch"]);
    // The flow was removed because nothing could deliver the mail it promised;
    // the contract must not advertise it back into existence.
    expect(Object.keys(doc.paths).filter((path) => path.includes("email-verification"))).toEqual([]);
  });
});
