import { resolve } from "node:path";
import dataRepository from "../../config/data-repository.json";
import { createRepositoryDbStore } from "../data/repository-db-store.ts";
import { serve } from "./serve.ts";

/** The Module root (`app/v3/src/server` → four levels up); its `db/` is the data checkout. */
const moduleRoot = resolve(import.meta.dir, "..", "..", "..", "..");

await serve(
  () =>
    createRepositoryDbStore({
      mountRoot: resolve(moduleRoot, "db"),
      expect: { ...dataRepository, within: moduleRoot },
    }),
  "v3",
);
