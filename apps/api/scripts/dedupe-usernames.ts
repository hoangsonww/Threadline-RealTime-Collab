/**
 * Report, and optionally resolve, duplicate usernames so the unique index on
 * `users.username` can be built.
 *
 * Registration did not check username uniqueness for most of this service's life,
 * so an existing database may hold duplicates. `MongoRepository.connect` refuses
 * to take the service down over that (see the incident in docs/operations.md) and
 * instead logs and carries on without the index — which leaves uniqueness
 * unenforceable until the duplicates are gone.
 *
 *   npm run dedupe:usernames --workspace=@threadline/api            # report only
 *   npm run dedupe:usernames --workspace=@threadline/api -- --apply # rename losers
 *
 * The oldest account keeps the username. Every other holder is renamed by
 * appending a short suffix, because the alternative — deleting an account or
 * silently merging two — destroys data this script has no business destroying.
 */
import { MongoClient } from "mongodb";
import type { User } from "../src/domain.js";

const uri = process.env.MONGODB_URI;
const apply = process.argv.includes("--apply");

if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

const suffix = (index: number) => `-${(index + 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  try {
    const users = client.db().collection<User>("users");
    const groups = await users
      .aggregate<{ _id: string; ids: string[] }>([
        { $group: { _id: "$username", ids: { $push: "$id" }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    if (groups.length === 0) {
      console.log("No duplicate usernames. The unique index can be built; restart the API to pick it up.");
      return;
    }

    console.log(`${groups.length} duplicated username(s):\n`);
    for (const group of groups) {
      // Oldest account keeps the name; ties broken by id for determinism.
      const holders = await users.find({ username: group._id }).sort({ createdAt: 1, id: 1 }).toArray();
      const [keeper, ...losers] = holders;
      console.log(`  ${group._id} — ${holders.length} accounts`);
      console.log(`    keep   ${keeper.id}  ${keeper.email}  (created ${keeper.createdAt.toISOString()})`);
      for (const [index, loser] of losers.entries()) {
        const renamed = `${group._id}${suffix(index)}`.slice(0, 32);
        console.log(`    rename ${loser.id}  ${loser.email}  ->  ${renamed}`);
        if (apply) await users.updateOne({ id: loser.id }, { $set: { username: renamed, updatedAt: new Date() } });
      }
    }

    console.log(
      apply
        ? "\nApplied. Restart the API so the unique index builds."
        : "\nReport only — nothing was written. Re-run with --apply to rename the accounts listed above.",
    );
  } finally {
    await client.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
