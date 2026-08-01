import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

export default tseslint.config(...tseslint.configs.recommended, {
  files: ["**/*.{ts,tsx}"],
  plugins: { "@next/next": nextPlugin },
  settings: { next: { rootDir: "." } },
  rules: nextPlugin.configs.recommended.rules,
});
