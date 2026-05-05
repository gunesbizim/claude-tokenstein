import { cpSync } from "fs";
cpSync("src/db/migrations", "dist/db/migrations", { recursive: true });
cpSync("src/pricing/prices.json", "dist/pricing/prices.json");
