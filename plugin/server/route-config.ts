import { type AuthConfig, GRAPH_TOOLS_ID, WORKFLOW_SCOPES } from "./auth.ts";

type Env = Record<string, string | undefined>;

/** An unset userConfig value may arrive empty or as the literal ${user_config.…} placeholder. */
const val = (v: string | undefined): string => (v && !v.includes("${") ? v.trim() : "");

/**
 * Which Teams route is configured. Anything but an explicit `workflow` is the bot route,
 * so an upgrader with bot settings and no teams_route set stays exactly as before.
 * The workflow route's sign-in carries no secret; the bot route builds its own auth elsewhere.
 */
export function routeConfig(env: Env): { route: "bot" | "workflow"; auth: AuthConfig | null; workflowUrl: string } {
  if (val(env.AWAY_TEAMS_ROUTE).toLowerCase() !== "workflow") return { route: "bot", auth: null, workflowUrl: "" };
  const app = val(env.AWAY_SIGN_IN_APP);
  const auth: AuthConfig | null = !app
    ? null
    : app.toLowerCase() === "graph-tools"
      ? { authority: "organizations", clientId: GRAPH_TOOLS_ID, scopes: WORKFLOW_SCOPES }
      : { authority: val(env.AWAY_TENANT_ID) || "organizations", clientId: app, scopes: WORKFLOW_SCOPES };
  return { route: "workflow", auth, workflowUrl: val(env.AWAY_WORKFLOW_URL) };
}
