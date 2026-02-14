import { FunctionTool } from "@google/adk";

const DEFAULT_CONFLUENCE_BASE_URL = "https://kodiganaveen.atlassian.net/wiki";
const CONFLUENCE_BASE_URL = (process.env.CONFLUENCE_BASE_URL || DEFAULT_CONFLUENCE_BASE_URL).replace(/\/$/, "");
const ATLASSIAN_EMAIL = process.env.CONFLUENCE_EMAIL || process.env.JIRA_EMAIL;
const ATLASSIAN_API_TOKEN = process.env.CONFLUENCE_API_TOKEN || process.env.JIRA_API_TOKEN;
const DEFAULT_SPACE_KEY = process.env.CONFLUENCE_DEFAULT_SPACE || process.env.JIRA_DEFAULT_PROJECT || null;

type ConfluenceOperation = "getPage" | "searchPages";

interface ConfluenceToolParams {
  operation: ConfluenceOperation;
  pageId?: string;
  cql?: string;
  limit?: number;
}

interface ConfluenceLinks {
  webui?: string;
  base?: string;
}

interface ConfluenceUserRef {
  displayName?: string;
}

interface ConfluenceLastUpdated {
  when?: string;
  friendlyWhen?: string;
  by?: ConfluenceUserRef;
}

interface ConfluenceVersionInfo {
  number?: number;
  when?: string;
  by?: ConfluenceUserRef;
}

interface ConfluenceSpaceRef {
  key?: string;
  name?: string;
}

interface ConfluenceBodyStorage {
  value?: string;
}

interface ConfluenceBody {
  storage?: ConfluenceBodyStorage;
}

interface ConfluenceContent {
  id: string;
  title: string;
  type?: string;
  status?: string;
  space?: ConfluenceSpaceRef;
  body?: ConfluenceBody;
  version?: ConfluenceVersionInfo;
  history?: { lastUpdated?: ConfluenceLastUpdated };
  _links?: ConfluenceLinks;
}

interface ConfluenceSearchResult {
  title?: string;
  excerpt?: string;
  content?: ConfluenceContent;
}

interface ConfluenceSearchResponse {
  size?: number;
  totalSize?: number;
  limit?: number;
  results: ConfluenceSearchResult[];
}

function assertConfig() {
  if (!CONFLUENCE_BASE_URL || !ATLASSIAN_EMAIL || !ATLASSIAN_API_TOKEN) {
    throw new Error(
      "CONFLUENCE_BASE_URL, ATLASSIAN_EMAIL (or JIRA_EMAIL), and ATLASSIAN_API_TOKEN (or JIRA_API_TOKEN) must be set."
    );
  }

  const baseUrl = CONFLUENCE_BASE_URL;
  const email = ATLASSIAN_EMAIL;
  const apiToken = ATLASSIAN_API_TOKEN;

  return { baseUrl, email, apiToken };
}

function buildUrl(path: string) {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return new URL(normalized, `${CONFLUENCE_BASE_URL}/`);
}

async function confluenceRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { email, apiToken } = assertConfig();
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  const url = buildUrl(path);
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
      ...(init?.headers || {}),
    },
    body: init?.body,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Confluence request failed: ${response.status} ${details}`);
  }

  return (await response.json()) as T;
}

function stripHtml(html?: string | null) {
  if (!html) {
    return null;
  }
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function resolveContentUrl(content: ConfluenceContent) {
  const { baseUrl } = assertConfig();
  const webui = content._links?.webui;
  if (webui) {
    return `${baseUrl}${webui}`;
  }
  const spaceKey = content.space?.key;
  if (spaceKey) {
    return `${baseUrl}/spaces/${spaceKey}/pages/${content.id}`;
  }
  return `${baseUrl}/pages/${content.id}`;
}

function mapContentSummary(content: ConfluenceContent) {
  return {
    id: content.id,
    title: content.title,
    spaceKey: content.space?.key ?? null,
    url: resolveContentUrl(content),
    version: content.version?.number ?? null,
    lastUpdated: content.history?.lastUpdated?.when || content.version?.when || null,
    lastUpdatedBy: content.history?.lastUpdated?.by?.displayName || content.version?.by?.displayName || null,
  };
}

async function fetchPage(pageId: string) {
  const query = new URLSearchParams({
    expand: "body.storage,version,history.lastUpdated,space",
  });
  const content = await confluenceRequest<ConfluenceContent>(`/rest/api/content/${pageId}?${query.toString()}`);
  return {
    ...mapContentSummary(content),
    excerpt: stripHtml(content.body?.storage?.value)?.slice(0, 600) ?? null,
  };
}

function buildDefaultCql() {
  if (DEFAULT_SPACE_KEY) {
    return `space = "${DEFAULT_SPACE_KEY}" ORDER BY lastmodified DESC`;
  }
  return "type = page ORDER BY lastmodified DESC";
}

async function searchPages(cql: string, limit: number) {
  const cappedLimit = Math.min(Math.max(limit, 1), 25);
  const query = new URLSearchParams({
    cql,
    limit: String(cappedLimit),
    expand: "content.history.lastUpdated,content.version,content.space,content._links",
  });
  const search = await confluenceRequest<ConfluenceSearchResponse>(`/rest/api/search?${query.toString()}`);
  return {
    total: search.totalSize ?? search.size ?? search.results.length,
    results: search.results
      .filter((entry) => Boolean(entry.content))
      .map((entry) => {
        const content = entry.content as ConfluenceContent;
        return {
          ...mapContentSummary(content),
          excerpt: stripHtml(entry.excerpt || content.body?.storage?.value)?.slice(0, 320) ?? null,
        };
      }),
  };
}

export const confluenceSearchTool = new FunctionTool({
  name: "confluenceSearch",
  description: "Search for Confluence pages by keywords. Searches page titles and content.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search keywords (e.g., 'deployment', 'sitemap', 'creation'). Can be partial words.",
      },
      cql: {
        type: "string",
        description: "Advanced: Raw CQL query if needed.",
      },
      limit: {
        type: "number",
        description: "Max results (1-25). Defaults to 15.",
      },
    },
    required: [],
  },
  execute: async (rawInput) => {
    const { query, cql, limit = 15 } = rawInput as { query?: string; cql?: string; limit?: number };
    
    let effectiveCql: string;
    
    if (cql && cql.trim()) {
      effectiveCql = cql.trim();
    } else if (query && query.trim()) {
      // Use simpler CQL that matches Confluence better
      const searchTerm = query.trim().replace(/"/g, '\\"');
      // Confluence text search without requiring exact match
      const spaceClause = DEFAULT_SPACE_KEY ? `space = "${DEFAULT_SPACE_KEY}"` : "type = page";
      effectiveCql = `${spaceClause} AND (title ~ "${searchTerm}" OR text ~ "${searchTerm}") ORDER BY lastmodified DESC`;
    } else {
      effectiveCql = buildDefaultCql();
    }
    
    if (!effectiveCql) {
      throw new Error("query or cql is required when no default Confluence space is configured.");
    }
    
    console.log("[Confluence Search] Using CQL:", effectiveCql);
    
    try {
      const result = await searchPages(effectiveCql, limit);
      console.log("[Confluence Search] Found", result.results.length, "results");
      return result;
    } catch (error) {
      const errorMsg = String(error || "");
      console.error("[Confluence Search] Error:", errorMsg);
      
      // Fallback: if search fails, list all pages in space
      if (DEFAULT_SPACE_KEY) {
        console.log("[Confluence Search] Falling back to listing all pages in space");
        const fallbackCql = `space = "${DEFAULT_SPACE_KEY}" AND type = page ORDER BY lastmodified DESC`;
        try {
          return await searchPages(fallbackCql, limit);
        } catch (fallbackError) {
          console.error("[Confluence Search] Fallback also failed:", String(fallbackError));
          throw error; // Throw original error
        }
      }
      throw error;
    }
  },
});

export const confluenceGetPageTool = new FunctionTool({
  name: "confluenceGetPage",
  description: "Fetch detailed content from a specific Confluence page by ID.",
  parameters: {
    type: "object",
    properties: {
      pageId: {
        type: "string",
        description: "Confluence page ID (numeric string).",
      },
    },
    required: ["pageId"],
  },
  execute: async (rawInput) => {
    const { pageId } = rawInput as { pageId: string };
    if (!pageId) {
      throw new Error("pageId is required.");
    }
    return fetchPage(pageId);
  },
});

export const confluenceListPagesTool = new FunctionTool({
  name: "confluenceListPages",
  description: "List all pages in the Confluence space.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Max pages to list (1-25). Defaults to 20.",
      },
    },
    required: [],
  },
  execute: async (rawInput) => {
    const { limit = 20 } = rawInput as { limit?: number };
    // List all pages in the default space
    if (!DEFAULT_SPACE_KEY) {
      throw new Error("Default Confluence space is not configured.");
    }
    const cql = `space = "${DEFAULT_SPACE_KEY}" AND type = page ORDER BY title ASC`;
    return await searchPages(cql, limit);
  },
});

// Keep the original tool for backwards compatibility
export const confluenceDataTool = confluenceSearchTool;
