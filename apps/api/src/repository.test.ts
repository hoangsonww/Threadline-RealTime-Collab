import { describe, expect, it } from "vitest";
import type { Credential, RoomEvent, User } from "./domain.js";
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

const roomEvent = (roomId: string, index: number): RoomEvent => ({
  id: `${roomId}-${index}`,
  roomId,
  type: "chat",
  payload: { text: `message ${index}` },
  actorId: "someone",
  createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
});

describe("room event history is bounded by the store", () => {
  const seed = async (repository: MemoryRepository, roomId: string, count: number) => {
    for (let index = 0; index < count; index += 1) await repository.writeRoomEvent(roomEvent(roomId, index));
  };

  it("returns at most `limit` events, taking the newest and handing them back oldest-first", async () => {
    const repository = new MemoryRepository();
    await seed(repository, "room-a", 50);

    const page = await repository.listRoomEvents("room-a", { limit: 10 });

    // The bound has to be applied here rather than by the caller. The route trims
    // too, which would hide an unbounded store — so this asserts the store itself.
    expect(page).toHaveLength(10);
    expect(page.at(0)?.id).toBe("room-a-40");
    expect(page.at(-1)?.id).toBe("room-a-49");
    const times = page.map((event) => event.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("pages backwards past a cursor without repeating anything", async () => {
    const repository = new MemoryRepository();
    await seed(repository, "room-a", 50);

    const newest = await repository.listRoomEvents("room-a", { limit: 10 });
    const older = await repository.listRoomEvents("room-a", { limit: 10, before: newest[0].createdAt });

    expect(older.at(-1)?.id).toBe("room-a-39");
    const newestIds = new Set(newest.map((event) => event.id));
    expect(older.some((event) => newestIds.has(event.id))).toBe(false);
  });

  it("never leaks another room's events into a page", async () => {
    const repository = new MemoryRepository();
    await seed(repository, "room-a", 20);
    await seed(repository, "room-b", 20);

    const page = await repository.listRoomEvents("room-a", { limit: 100 });
    expect(page).toHaveLength(20);
    expect(page.every((event) => event.roomId === "room-a")).toBe(true);
  });

  it("bounds the cross-room activity feed too, newest first", async () => {
    const repository = new MemoryRepository();
    await seed(repository, "room-a", 30);
    await seed(repository, "room-b", 30);

    const feed = await repository.listRoomEventsForRooms(["room-a", "room-b"], { limit: 15 });

    // This one previously read every event in every visible room to return a
    // hundred of them, which is the read that grows without bound as a workspace ages.
    expect(feed).toHaveLength(15);
    const times = feed.map((event) => event.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(feed.every((event) => ["room-a", "room-b"].includes(event.roomId))).toBe(true);
  });

  it("excludes rooms the caller cannot see", async () => {
    const repository = new MemoryRepository();
    await seed(repository, "visible", 5);
    await seed(repository, "hidden", 5);

    const feed = await repository.listRoomEventsForRooms(["visible"], { limit: 100 });
    expect(feed.every((event) => event.roomId === "visible")).toBe(true);
    expect(await repository.listRoomEventsForRooms([], { limit: 100 })).toEqual([]);
  });
});
