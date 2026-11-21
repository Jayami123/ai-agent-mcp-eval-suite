import { TWENTY_DEFAULT_ADMIN_EMAIL, TWENTY_DEV_SEED_PASSWORD, type ProductAdapter } from "qa-portfolio-harness";

// TW1: the Twenty seed for the approval wave B cases (docs/plans/2026-11-21-l3-appr-wave-b.md, section 2.1).
// Records are written through Twenty's own GraphQL API with the admin's workspace token, so the product's validation and
// search vectors run. Field and mutation names come from the pinned fork (Jayami123/twenty-crm at 7cbdfec6): standard
// objects in twenty-standard-application/utils/field-metadata, and the dev seeder's stage values.
// Every title starts with P4L3 so the sweep can find the rows. Fake data only. Tokens are never printed.

/** Workspace A (Apple) and workspace B (YCombinator) ids from the dev seeder (seeder-workspaces.constant.ts). */
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

/** A Twenty session for one workspace. Records are created and read through its core API. */
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

/** Signs in as the harness admin and returns each workspace the admin can enter, with its login token. */
async function workspaceLogins(baseUrl: string): Promise<WorkspaceLogin[]> {
  const data = (await postJson(`${baseUrl}/metadata`, { query: SIGN_IN, variables: { email: TWENTY_DEFAULT_ADMIN_EMAIL, password: TWENTY_DEV_SEED_PASSWORD } })) as {
    signIn?: { availableWorkspaces?: { availableWorkspacesForSignIn?: WorkspaceLogin[] } };
  };
  return data.signIn?.availableWorkspaces?.availableWorkspacesForSignIn ?? [];
}

/** The admin's token for one workspace (login token, then the exchange the harness also uses). */
export async function twentyWorkspaceClient(adapter: ProductAdapter, workspaceId: string): Promise<TwentyWorkspaceClient> {
  const baseUrl = adapter.baseUrl.replace(/\/$/, "");
  const ws = (await workspaceLogins(baseUrl)).find((w) => w.id === workspaceId);
  if (ws === undefined) throw new Error(`TWENTY_TW1_NO_MEMBERSHIP: the admin is not a member of workspace ${workspaceId} (check the dev seed)`);
  const origin = (ws.workspaceUrls?.subdomainUrl ?? ws.workspaceUrls?.customUrl ?? baseUrl).replace(/\/$/, "");
  const exchanged = (await postJson(`${baseUrl}/metadata`, { query: EXCHANGE, variables: { loginToken: ws.loginToken, origin } })) as {
    getAuthTokensFromLoginToken?: { tokens?: { accessOrWorkspaceAgnosticToken?: { token?: string } } };
  };
  const token = exchanged.getAuthTokensFromLoginToken?.tokens?.accessOrWorkspaceAgnosticToken?.token;
  if (typeof token !== "string") throw new Error("TWENTY_TW1_NO_TOKEN: the token exchange returned no access token");
  return new TwentyWorkspaceClient(baseUrl, workspaceId, token);
}

/** Deletes every P4L3 row in both workspaces (notes first, then links, then companies and opportunities). */
export async function sweepTwentyP4L3(adapter: ProductAdapter): Promise<void> {
  for (const wsId of [TW_WORKSPACE_A, TW_WORKSPACE_B]) {
    const c = await twentyWorkspaceClient(adapter, wsId);
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
}

export interface Tw1Ids {
  /** Workspace A (Apple). */
  companyAlpha: string;
  dealAlpha: string;
  dealGamma: string;
  /** The poisoned note linked to Deal Alpha (INJ-005). */
  noteAlpha: string;
  /** The poisoned note linked to Deal Gamma (INJ-006; the opportunity has no description field, decision D2). */
  noteGamma: string;
  /** The note-target row that links the Gamma note to Deal Gamma (INJ-006 changes and deletes it). */
  noteTargetGamma: string;
  /** Workspace B (YCombinator). */
  companyB: string;
  dealB: string;
}

/**
 * Creates the TW1 records. The poisoned note bodies are passed in by the caller (fixtures are JSON, not code). Canary text
 * is only in the note bodies; the titles are fixed so the sweep finds them.
 */
export async function seedTw1(adapter: ProductAdapter, poison: { alpha: string; gamma: string }): Promise<Tw1Ids> {
  await sweepTwentyP4L3(adapter);
  const a = await twentyWorkspaceClient(adapter, TW_WORKSPACE_A);
  const b = await twentyWorkspaceClient(adapter, TW_WORKSPACE_B);

  const companyAlpha = await a.create("createCompany", { name: "P4L3 Acme Co" });
  const dealAlpha = await a.create("createOpportunity", { name: "P4L3 Deal Alpha", stage: "NEW", amount: { amountMicros: 7654321000000, currencyCode: "USD" }, companyId: companyAlpha });
  const dealGamma = await a.create("createOpportunity", { name: "P4L3 Deal Gamma", stage: "MEETING", amount: { amountMicros: 1200000000000, currencyCode: "USD" }, companyId: companyAlpha });
  const noteAlpha = await a.create("createNote", { title: "P4L3 poisoned note", bodyV2: { markdown: poison.alpha } });
  await a.create("createNoteTarget", { noteId: noteAlpha, opportunityId: dealAlpha });
  const noteGamma = await a.create("createNote", { title: "P4L3 poisoned description", bodyV2: { markdown: poison.gamma } });
  const noteTargetGamma = await a.create("createNoteTarget", { noteId: noteGamma, opportunityId: dealGamma });

  const companyB = await b.create("createCompany", { name: "P4L3 B-only Co" });
  const dealB = await b.create("createOpportunity", { name: "P4L3 B-only Deal", stage: "NEW", amount: { amountMicros: 550000000000, currencyCode: "USD" }, companyId: companyB });

  return { companyAlpha, dealAlpha, dealGamma, noteAlpha, noteGamma, noteTargetGamma, companyB, dealB };
}
