import { describe, expect, it } from "vitest";
import type { Credential, User } from "./domain.js";
import { MemoryRepository, UsernameTakenError } from "./repository.js";

const account = (id: string, username: string, email = `${id}@example.com`): User => ({
  id,
  email,
  username,
  displayName: `User ${id}`,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const credential = (userId: string): Credential => ({
  userId,
  passwordHash: "hash",
  passwordUpdatedAt: new Date(),
});

describe("username uniqueness", () => {
  it("refuses a second account with the same username", async () => {
    const repository = new MemoryRepository();
    await repository.createUser(account("a", "taken"), credential("a"));

    await expect(repository.createUser(account("b", "taken"), credential("b"))).rejects.toBeInstanceOf(
      UsernameTakenError,
    );
  });

  it("refuses a rename onto a username another account already holds", async () => {
    const repository = new MemoryRepository();
    await repository.createUser(account("a", "first"), credential("a"));
    await repository.createUser(account("b", "second"), credential("b"));

    await expect(repository.updateUser(account("b", "first"))).rejects.toBeInstanceOf(UsernameTakenError);
    // The rejected write must not have partially applied.
    expect((await repository.getUserById("b"))?.username).toBe("second");
  });

  it("allows an account to keep its own username across an unrelated update", async () => {
    const repository = new MemoryRepository();
    await repository.createUser(account("a", "stable"), credential("a"));

    // Re-asserting your own username is not a collision with yourself — the
    // uniqueness check has to exclude the row being written.
    const renamed = { ...account("a", "stable"), displayName: "Renamed" };
    await expect(repository.updateUser(renamed)).resolves.toBeUndefined();
    expect((await repository.getUserById("a"))?.displayName).toBe("Renamed");
  });

  it("frees a username for reuse once its holder is renamed away", async () => {
    const repository = new MemoryRepository();
    await repository.createUser(account("a", "wanted"), credential("a"));
    await repository.createUser(account("b", "other"), credential("b"));

    await repository.updateUser(account("a", "moved-on"));
    await expect(repository.updateUser(account("b", "wanted"))).resolves.toBeUndefined();
  });
});
