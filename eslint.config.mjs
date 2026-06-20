import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "tmp/**",
      "coverage/**",
      "src/generated/**",
      "next-env.d.ts",
      "prisma.config.ts",
    ],
  },
  {
    // Every AI mutation must route through `runAiMutation`/`useAiMutation` (src/hooks/use-ai-usage.ts)
    // so the AI usage meter refetches after a token is spent. A direct `api.POST('/ai/…')` or
    // `$api.useMutation('post', '/ai/…')` anywhere else bypasses that invalidation.
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='api'][callee.property.name='POST'] > Literal[value=/^\\/ai\\//]",
          message:
            "Call AI routes through runAiMutation/useAiMutation (src/hooks/use-ai-usage.ts), not api.POST('/ai/…') directly — otherwise the AI usage meter never refetches.",
        },
        {
          selector:
            "CallExpression[callee.object.name='$api'][callee.property.name='useMutation'] > Literal[value=/^\\/ai\\//]",
          message:
            "Call AI routes through runAiMutation/useAiMutation (src/hooks/use-ai-usage.ts), not a $api AI mutation directly — otherwise the AI usage meter never refetches.",
        },
      ],
    },
  },
  {
    // The wrapper itself is the one sanctioned place that calls `api.POST` for AI routes.
    files: ["src/hooks/use-ai-usage.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;
