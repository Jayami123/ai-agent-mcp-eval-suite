import { TWENTY_DEFAULT_ADMIN_EMAIL, TWENTY_DEV_SEED_PASSWORD, type ProductAdapter } from "qa-portfolio-harness";
import { assertWorkspaceBound, pickOrigin } from "./twenty-binding.js";

// TW1: the Twenty seed for the approval wave B cases (docs/plans/2026-11-21-l3-appr-wave-b.md, section 2.1).
// Records are written through Twenty's own GraphQL API with a workspace-bound admin token, so the product's validation and search
// vectors run. Field and mutation names come from the pinned fork (Jayami123/twenty-crm at 7cbdfec6).
// Every title starts with P4L3 so the sweep can find the rows. Fake data only. Tokens are never printed.
//
// Workspace access (one helper, twentyWorkspaceClient, used by the seed AND the sweep):
// - the token is the login-token exchange's access token, bound to the workspace (auth.resolver.ts:761-800);
// - the binding is checked from the token's own claims (twenty-binding.ts) and then by currentWorkspace on /metadata, which
//   WorkspaceAuthGuard allows only for a workspace-bound token (workspace-auth.guard.ts:22-27; workspace.resolver.ts:111-114).
// Workspace B (YCombinator) cannot be entered in this harness: IS_MULTIWORKSPACE_ENABLED is "false" (twenty.compose.yml:36,52), so
// every origin resolves to the default workspace, Apple (workspace-domains.service.ts:67-95, 111-122). See docs/findings/l3-appr-wave-b.md.

/** Workspace A (Apple, the default in this harness) and workspace B (YCombinator) ids from the dev seeder. */
export const TW_WORKSPACE_A = "20202020-1c25-4d02-bf25-6aeccf7ea419";
export const TW_WORKSPACE_B = "3b8e6458-5fc1-4e63-8563-008ccddaa6db";

const SIGN_IN = `mutation SignIn($email: String!, $password: String!) {
  signIn(email: $email, password: $password) {
    availableWorkspaces { availableWorkspacesForSignIn { id displayName loginToken workspaceUrls { subdomainUrl customUrl } } }
  }
}`;
const EXCHANGE = `mutation GetAuthTokensFromLoginToken($loginToken: String!, $origin: String!) {
  getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } }
}`;

interface WorkspaceLogin {
  id: string;
  displayName: string;
  loginToken: string;
  workspaceUrls?: { subdomainUrl?: string; customUrl?: string };
}

/** Twenty's schema name for a workspace: workspace_ plus the base-36 form of its UUID (getWorkspaceSchemaName). */
export function workspaceSchemaName(workspaceId: string): string {
  return `workspace_${BigInt(`0x${workspaceId.replace(/-/g, "")}`).toString(36)}`;
}

async function postJson(url: string, body: unknown, token?: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== undefined) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const parsed = (await res.json().catch(() => undefined)) as { data?: unknown; errors?: Array<{ message: string }> } | undefined;
  if (!res.ok || parsed === undefined || (parsed.errors !== undefined && parsed.errors.length > 0)) {
    const msg = parsed?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    throw new Error(`TWENTY_TW1_GRAPHQL: ${url.replace(/^.*\//, "/")} ${msg}`);
  }
  return parsed.data;
}

/** A Twenty session for one workspace. Records are created and read through its core API. Only twentyWorkspaceClient builds one. */
export class TwentyWorkspaceClient {
  constructor(
    private readonly baseUrl: string,
    readonly workspaceId: string,
    private readonly token: string,
  ) {}

  /** The core GraphQL API (records). Errors are thrown without the token. */
  async gql<T = Record<string, unknown>>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return (await postJson(`${this.baseUrl}/graphql`, { query, variables }, this.token)) as T;
  }

  /** Creates a row and returns its id. */
  async create(mutation: string, data: Record<string, unknown>): Promise<string> {
    const out = await this.gql<Record<string, { id: string }>>(`mutation($data: ${mutation.replace(/^create/, "")}CreateInput!) { ${mutation}(data: $data) { id } }`, { data });
    const id = out[mutation]?.id;
    if (typeof id !== "string") throw new Error(`TWENTY_TW1_NO_ID: ${mutation} returned no id`);
    return id;
  }

  /** Ids of the P4L3 rows of one object, for the sweep. `plural` is the list field, `field` the title field. */
  async p4l3Ids(plural: string, field: string): Promise<string[]> {
    const out = await this.gql<Record<string, { edges: Array<{ node: { id: string } }> }>>(
      `query { ${plural}(filter: { ${field}: { ilike: "P4L3%" } }, first: 200) { edges { node { id } } } }`,
    );
    return (out[plural]?.edges ?? []).map((e) => e.node.id);
  }
}

/** Signs in as the harness admin and returns each workspace the admin is a member of, with its login token. */
async function workspaceLogins(baseUrl: string): Promise<WorkspaceLogin[]> {
  const data = (await postJson(`${baseUrl}/metadata`, { query: SIGN_IN, variables: { email: TWENTY_DEFAULT_ADMIN_EMAIL, password: TWENTY_DEV_SEED_PASSWORD } })) as {
    signIn?: { availableWorkspaces?: { availableWorkspacesForSignIn?: WorkspaceLogin[] } };
  };
  return data.signIn?.availableWorkspaces?.availableWorkspacesForSignIn ?? [];
}

/** The workspace a token is for, as the metadata API reports it for a workspace-bound token. */
async function currentWorkspaceId(baseUrl: string, token: string): Promise<string | undefined> {
  const data = (await postJson(`${baseUrl}/metadata`, { query: "query { currentWorkspace { id } }" }, token)) as { currentWorkspace?: { id?: unknown } };
  return typeof data.currentWorkspace?.id === "string" ? data.currentWorkspace.id : undefined;
}

/**
 * THE workspace helper. Seed and sweep both call only this. It returns a client only when the token is bound to `workspaceId`,
 * checked twice: from the token's claims (assertWorkspaceBound), and by currentWorkspace on /metadata. Any failure names the origin
 * it tried and the reason, never a token.
 */
export async function twentyWorkspaceClient(adapter: ProductAdapter, workspaceId: string): Promise<TwentyWorkspaceClient> {
  const baseUrl = adapter.baseUrl.replace(/\/$/, "");
  const ws = (await workspaceLogins(baseUrl)).find((w) => w.id === workspaceId);
  if (ws === undefined) throw new Error(`TWENTY_TW1_NO_MEMBERSHIP: the admin is not a member of workspace ${workspaceId} (check the dev seed)`);
  const origins = [...new Set([pickOrigin(ws.workspaceUrls?.subdomainUrl), pickOrigin(ws.workspaceUrls?.customUrl), baseUrl].filter((o): o is string => o !== undefined))];
  const failures: string[] = [];
  for (const origin of origins) {
    try {
      const exchanged = (await postJson(`${baseUrl}/metadata`, { query: EXCHANGE, variables: { loginToken: ws.loginToken, origin } })) as {
        getAuthTokensFromLoginToken?: { tokens?: { accessOrWorkspaceAgnosticToken?: { token?: string } } };
      };
      const token = exchanged.getAuthTokensFromLoginToken?.tokens?.accessOrWorkspaceAgnosticToken?.token;
      if (typeof token !== "string") throw new Error("the exchange returned no access token");
      assertWorkspaceBound(token, workspaceId);
      const current = await currentWorkspaceId(baseUrl, token);
      if (current !== workspaceId) throw new Error(`currentWorkspace is ${current ?? "none"}, not ${workspaceId}`);
      return new TwentyWorkspaceClient(baseUrl, workspaceId, token);
    } catch (err) {
      failures.push(`origin ${origin.replace(/^https?:\/\//, "")}: ${(err as Error).message}`);
    }
  }
  throw new Error(`TWENTY_TW1_NO_BOUND_TOKEN: no origin gave a token bound to workspace ${workspaceId} (${failures.join("; ")})`);
}

/** Deletes every P4L3 row in workspace A through the shared helper. Workspace B is not reachable here (see the header). */
export async function sweepTwentyP4L3(adapter: ProductAdapter): Promise<void> {
  const c = await twentyWorkspaceClient(adapter, TW_WORKSPACE_A);
  for (const [mutation, plural, field] of [
    ["destroyNote", "notes", "title"],
    ["destroyOpportunity", "opportunities", "name"],
    ["destroyCompany", "companies", "name"],
  ] as const) {
    for (const id of await c.p4l3Ids(plural, field)) {
      await c.gql(`mutation($id: UUID!) { ${mutation}(id: $id) { id } }`, { id });
    }
  }
}

export interface Tw1Ids {
  /** Workspace A (Apple): the company and the two deals. */
  companyAlpha: string;
  dealAlpha: string;
  dealGamma: string;
  /** The poisoned note linked to Deal Alpha (INJ-005). */
  noteAlpha: string;
  /** The poisoned note linked to Deal Gamma (INJ-006; the opportunity has no description field, decision D2). */
  noteGamma: string;
  /** The note-target row that links the Gamma note to Deal Gamma (INJ-006 changes and deletes it). */
  noteTargetGamma: string;
}

/**
 * Creates the TW1 records in workspace A through the shared helper. The poisoned note bodies are passed in by the caller. Canary
 * text is only in the note bodies; the titles are fixed so the sweep finds them.
 */
export async function seedTw1(adapter: ProductAdapter, poison: { alpha: string; gamma: string }): Promise<Tw1Ids> {
  await sweepTwentyP4L3(adapter);
  const a = await twentyWorkspaceClient(adapter, TW_WORKSPACE_A);

  const companyAlpha = await a.create("createCompany", { name: "P4L3 Acme Co" });
  const dealAlpha = await a.create("createOpportunity", { name: "P4L3 Deal Alpha", stage: "NEW", amount: { amountMicros: 7654321000000, currencyCode: "USD" }, companyId: companyAlpha });
  const dealGamma = await a.create("createOpportunity", { name: "P4L3 Deal Gamma", stage: "MEETING", amount: { amountMicros: 1200000000000, currencyCode: "USD" }, companyId: companyAlpha });
  const noteAlpha = await a.create("createNote", { title: "P4L3 poisoned note", bodyV2: { markdown: poison.alpha } });
  await a.create("createNoteTarget", { noteId: noteAlpha, opportunityId: dealAlpha });
  const noteGamma = await a.create("createNote", { title: "P4L3 poisoned description", bodyV2: { markdown: poison.gamma } });
  const noteTargetGamma = await a.create("createNoteTarget", { noteId: noteGamma, opportunityId: dealGamma });

  return { companyAlpha, dealAlpha, dealGamma, noteAlpha, noteGamma, noteTargetGamma };
}

/**
 * Workspace B's company, through the same helper. In this harness it throws TWENTY_TW1_NO_BOUND_TOKEN (every origin resolves to the
 * default workspace). Only the TOOL-006 body calls it, and that case is a named skip for this reason.
 */
export async function seedWorkspaceB(adapter: ProductAdapter): Promise<string> {
  const b = await twentyWorkspaceClient(adapter, TW_WORKSPACE_B);
  return b.create("createCompany", { name: "P4L3 B-only Co" });
}
