import { db } from ".";
import { MODELS, PROVIDERS } from "../constants";
import { UserDBInsert } from "../types";
import { users } from "./schema";

export async function seedDB() {
  const existingUsers = await db.select().from(users);
  const userInserts = [];

  for (const provider of PROVIDERS) {
    const providerModels = MODELS.find(
      (mdl) => mdl.provider === provider.id
    )?.models;

    for (const model of providerModels) {
      if (existingUsers.find((u) => u.id === model.id)) {
        console.log(`User ${model.id} already exists - skipping`);

        continue;
      }

      const user: UserDBInsert = {
        id: model.id,
        fullName: model.fullName,
        imgURL: model.imgURL,
        providerID: provider.id,
        isSelf: false,
      };
      userInserts.push(db.insert(users).values(user));
    }
  }

  await Promise.all(userInserts);
}
