import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Tenant safety: only src/lib/db.ts and src/lib/platform-db.ts may import the Postgres driver,
  // only src/lib/redis.ts may import the Redis client.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/db.ts", "src/lib/platform-db.ts", "src/lib/redis.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "postgres", message: "Use withTenant()/withSystem() from @/lib/db — never the driver directly." },
            { name: "@upstash/redis", message: "Use redis()/keys from @/lib/redis." },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "coverage/**"]),
]);

export default eslintConfig;
