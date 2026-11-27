import { expect, test } from "bun:test";
import { GRAPH_TOOLS_ID, WORKFLOW_SCOPES } from "../plugin/server/auth.ts";
import { routeConfig } from "../plugin/server/route-config.ts";

test("unset route is bot", () => {
  for (const v of [undefined, "", "bot", "junk", "${user_config.teams_route}"]) {
    expect(routeConfig({ AWAY_TEAMS_ROUTE: v, AWAY_SIGN_IN_APP: "app" }).route).toBe("bot");
  }
  expect(routeConfig({}).auth).toBeNull();
});

test("workflow with graph-tools uses organizations", () => {
  const r = routeConfig({ AWAY_TEAMS_ROUTE: "workflow", AWAY_SIGN_IN_APP: "graph-tools", AWAY_TENANT_ID: "tid", AWAY_WORKFLOW_URL: "https://x/y?sig=1" });
  expect(r.route).toBe("workflow");
  expect(r.auth).toEqual({ authority: "organizations", clientId: GRAPH_TOOLS_ID, scopes: WORKFLOW_SCOPES });
  expect(r.workflowUrl).toBe("https://x/y?sig=1");
});

test("workflow with an app id uses the tenant", () => {
  const r = routeConfig({ AWAY_TEAMS_ROUTE: "workflow", AWAY_SIGN_IN_APP: "my-app", AWAY_TENANT_ID: "tid" });
  expect(r.auth).toEqual({ authority: "tid", clientId: "my-app", scopes: WORKFLOW_SCOPES });
  expect(r.auth?.botSecret).toBeUndefined();
  expect(routeConfig({ AWAY_TEAMS_ROUTE: "workflow", AWAY_SIGN_IN_APP: "my-app" }).auth?.authority).toBe("organizations");
});

test("workflow with no sign-in app has no auth", () => {
  expect(routeConfig({ AWAY_TEAMS_ROUTE: "workflow", AWAY_SIGN_IN_APP: "${user_config.sign_in_app}" }).auth).toBeNull();
  expect(routeConfig({ AWAY_TEAMS_ROUTE: "workflow" }).workflowUrl).toBe("");
});
