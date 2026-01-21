import { FunctionTool } from "@google/adk";

type JiraOperation = "getIssue" | "searchIssues";

interface JiraToolParams {
  operation: JiraOperation;
  issueKey?: string;
  jql?: string;
  maxResults?: number;
}

interface JiraIssueFields {
  summary?: string;
  status?: { name?: string };
  assignee?: { displayName?: string } | null;
}

interface JiraIssueResponse {
  key: string;
  fields?: JiraIssueFields;
}

interface JiraSearchResponse {
  total?: number;
  nextPageToken?: string;
  issues: JiraIssueResponse[];
}

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const JIRA_DEFAULT_PROJECT = process.env.JIRA_DEFAULT_PROJECT;
const JIRA_DEFAULT_JQL =
  process.env.JIRA_DEFAULT_JQL ||
  (JIRA_DEFAULT_PROJECT ? `project = ${JIRA_DEFAULT_PROJECT} ORDER BY updated DESC` : "ORDER BY updated DESC");

function getJiraConfig() {
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new Error(
      "JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN must be set in the environment."
    );
  }

  return {
    baseUrl: JIRA_BASE_URL,
    email: JIRA_EMAIL,
    apiToken: JIRA_API_TOKEN,
  };
}

async function jiraRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, email, apiToken } = getJiraConfig();
  const url = new URL(path, baseUrl);
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
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
    throw new Error(`Jira request failed: ${response.status} ${details}`);
  }

  return (await response.json()) as T;
}

function mapIssue(issue: JiraIssueResponse) {
  const { baseUrl } = getJiraConfig();
  const fields = issue.fields || {};
  return {
    key: issue.key,
    summary: fields.summary ?? "Summary unavailable",
    status: fields.status?.name ?? "Unknown",
    assignee: fields.assignee?.displayName ?? null,
    url: `${baseUrl}/browse/${issue.key}`,
  };
}

async function fetchIssue(issueKey: string) {
  const issue = await jiraRequest<JiraIssueResponse>(`/rest/api/3/issue/${issueKey}`);
  return mapIssue(issue);
}

async function searchIssues(jql: string, maxResults: number) {
  const cappedMax = Math.min(Math.max(maxResults, 1), 50);
  const payload = JSON.stringify({
    jql,
    maxResults: cappedMax,
    fields: ["summary", "status", "assignee"],
  });
  const search = await jiraRequest<JiraSearchResponse>("/rest/api/3/search/jql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  return {
    total: search.total ?? search.issues.length,
    nextPageToken: search.nextPageToken ?? null,
    issues: search.issues.map(mapIssue),
  };
}

export const jiraDataTool = new FunctionTool({
  name: "jiraCloudData",
  description:
    "Interact with Jira Cloud to read issues or run searches via the REST API.",
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["getIssue", "searchIssues"],
        description: "Choose the Jira action to perform.",
      },
      issueKey: {
        type: "string",
        description: "Issue key such as ABC-123. Required for getIssue.",
      },
      jql: {
        type: "string",
        description: "JQL expression. Required for searchIssues.",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of issues to return when searching (1-50).",
      },
    },
    required: ["operation"],
  },
  execute: async (rawInput) => {
    const { operation, issueKey, jql, maxResults = 20 } = rawInput as JiraToolParams;

    if (operation === "getIssue") {
      if (!issueKey) {
        throw new Error("issueKey is required when operation is getIssue.");
      }
      return fetchIssue(issueKey);
    }

    if (operation === "searchIssues") {
      const effectiveJql = (jql?.trim() || JIRA_DEFAULT_JQL)?.trim();
      if (!effectiveJql) {
        throw new Error(
          "jql is required when operation is searchIssues. Set JIRA_DEFAULT_JQL or JIRA_DEFAULT_PROJECT for a default query."
        );
      }
      return searchIssues(effectiveJql, maxResults);
    }

    throw new Error(`Unsupported Jira operation: ${operation}`);
  },
});
