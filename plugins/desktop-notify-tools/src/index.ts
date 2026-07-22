import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const configSchema = Type.Object(
  {
    cooldownSeconds: Type.Optional(Type.Number({ minimum: 0, maximum: 86400 })),
    defaultDurationSeconds: Type.Optional(Type.Number({ minimum: 3, maximum: 30 })),
  },
  { additionalProperties: false },
);

const notifyParameters = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 80 }),
    message: Type.String({ minLength: 1, maxLength: 1000 }),
    severity: Type.Optional(
      Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("urgent")]),
    ),
    durationSeconds: Type.Optional(Type.Integer({ minimum: 3, maximum: 30 })),
    dedupeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  },
  { additionalProperties: false },
);

function result(details: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

const recent = new Map<string, number>();
const scriptPath = fileURLToPath(new URL("../notify.ps1", import.meta.url));
const powershellPath = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

const plugin = defineToolPlugin({
  id: "desktop-notify-tools",
  name: "Desktop Notify Tools",
  description: "Show a short Windows desktop reminder popup.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "butler_desktop_notify",
      label: "Windows desktop reminder",
      description:
        "Show one concise Windows popup for an important due reminder, abnormal condition, safety risk, or explicit notification request.",
      parameters: notifyParameters,
      factory({ config, toolContext }) {
        if (toolContext.agentId !== "main" && toolContext.agentId !== "router") return null;

        const configured = (config ?? {}) as Static<typeof configSchema>;
        const cooldownMs = (configured.cooldownSeconds ?? 60) * 1000;
        const defaultDuration = Math.round(configured.defaultDurationSeconds ?? 8);

        return {
          name: "butler_desktop_notify",
          label: "Windows desktop reminder",
          description: "Show a concise Windows desktop notification.",
          parameters: notifyParameters,
          execute: async (_toolCallId: string, params: Static<typeof notifyParameters>) => {
            const severity = params.severity ?? "info";
            const duration = params.durationSeconds ?? defaultDuration;
            const key = params.dedupeKey ?? `${severity}|${params.title}|${params.message}`;
            const now = Date.now();
            const last = recent.get(key);

            if (last !== undefined && now - last < cooldownMs) {
              return result({ ok: true, shown: false, deduplicated: true, dedupeKey: key });
            }

            recent.set(key, now);
            const child = spawn(
              powershellPath,
              [
                "-NoProfile",
                "-STA",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                scriptPath,
                "-Title",
                params.title,
                "-Message",
                params.message,
                "-Severity",
                severity,
                "-DurationSeconds",
                String(duration),
              ],
              { detached: true, stdio: "ignore", windowsHide: true },
            );
            child.unref();

            return result({
              ok: true,
              shown: true,
              deduplicated: false,
              dedupeKey: key,
              durationSeconds: duration,
            });
          },
        };
      },
    }),
  ],
});

export default plugin;
