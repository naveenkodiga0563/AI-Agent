import { FunctionTool } from "@google/adk";

type JiraOperation = "getIssue" | "searchIssues" | "createIssue" | "updateIssue" | "deleteIssue" | "addComment";

interface JiraToolParams {
  operation: JiraOperation;
  issueKey?: string;
  jql?: string;
  maxResults?: number;
  summary?: string;
  description?: string;
  issueType?: string;
  assignee?: string;
  status?: string;
  comment?: string;
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
  // Use the supported JQL search endpoint. Some Jira instances may
  // require `/rest/api/3/search/jql` (see CHANGE-2046). Try the
  // preferred `/search/jql` first and fall back to `/search` for
  // compatibility with older instances.
  let search: JiraSearchResponse;
  try {
    search = await jiraRequest<JiraSearchResponse>("/rest/api/3/search/jql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
  } catch (err) {
    const msg = String(err || "");
    if (msg.includes("410") || msg.includes("search/jql") || msg.includes("已被移除")) {
      // Retry against the alternate path if the instance explicitly
      // told us to migrate or returned a 410.
      search = await jiraRequest<JiraSearchResponse>("/rest/api/3/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
    } else {
      throw err;
    }
  }

  return {
    total: search.total ?? search.issues.length,
    nextPageToken: search.nextPageToken ?? null,
    issues: search.issues.map(mapIssue),
  };
}

// Convert plain text to Atlassian Document Format (ADF)
function textToADF(text: string) {
  if (!text || text.trim() === "") {
    return undefined;
  }

  // Split by newlines and create paragraphs
  const paragraphs = text.split("\n").map((line) => ({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: line || " ", // Empty lines still need content
      },
    ],
  }));

  return {
    version: 1,
    type: "doc",
    content: paragraphs,
  };
}

async function createIssue(
  summary: string,
  description: string,
  issueType: string = "Story",
  assignee?: string
) {
  if (!summary) {
    throw new Error("summary is required to create an issue.");
  }

  const projectKey = JIRA_DEFAULT_PROJECT || "DEFAULTPROJECT";
  const descriptionADF = textToADF(description);
  
  const payload = JSON.stringify({
    fields: {
      project: { key: projectKey },
      summary,
      ...(descriptionADF ? { description: descriptionADF } : {}),
      issuetype: { name: issueType },
      ...(assignee ? { assignee: { name: assignee } } : {}),
    },
  });

  const response = await jiraRequest<{ key: string; id: string }>("/rest/api/3/issue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });

  return {
    issueKey: response.key,
    issueId: response.id,
    message: `Successfully created ${response.key}`,
    url: `${getJiraConfig().baseUrl}/browse/${response.key}`,
  };
}

async function updateIssue(
  issueKey: string,
  summary?: string,
  description?: string,
  status?: string,
  assignee?: string
) {
  if (!issueKey) {
    throw new Error("issueKey is required to update an issue.");
  }

  const fields: Record<string, unknown> = {};
  if (summary) fields.summary = summary;
  if (description) {
    const descriptionADF = textToADF(description);
    if (descriptionADF) fields.description = descriptionADF;
  }
  if (assignee) fields.assignee = { name: assignee };

  const payload = JSON.stringify({ fields });

  await jiraRequest("/rest/api/3/issue/" + issueKey, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });

  // Handle status separately if provided, as it requires a transition
  if (status) {
    const transitions = await jiraRequest<{ transitions: Array<{ id: string; name: string }> }>(
      `/rest/api/3/issue/${issueKey}/transitions`
    );

    const targetTransition = transitions.transitions.find(
      (t) => t.name.toLowerCase() === status.toLowerCase()
    );

    if (targetTransition) {
      await jiraRequest(`/rest/api/3/issue/${issueKey}/transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transition: { id: targetTransition.id } }),
      });
    }
  }

  return {
    issueKey,
    message: `Successfully updated ${issueKey}`,
    url: `${getJiraConfig().baseUrl}/browse/${issueKey}`,
  };
}

async function deleteIssue(issueKey: string) {
  if (!issueKey) {
    throw new Error("issueKey is required to delete an issue.");
  }

  await jiraRequest(`/rest/api/3/issue/${issueKey}`, {
    method: "DELETE",
  });

  return {
    issueKey,
    message: `Successfully deleted ${issueKey}`,
  };
}

async function addComment(issueKey: string, comment: string) {
  if (!issueKey) {
    throw new Error("issueKey is required to add a comment.");
  }
  if (!comment) {
    throw new Error("comment is required to add a comment.");
  }

  const commentADF = textToADF(comment);
  const payload = JSON.stringify({
    body: commentADF || {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: comment,
            },
          ],
        },
      ],
    },
  });

  const response = await jiraRequest<{ id: string }>(
    `/rest/api/3/issue/${issueKey}/comment`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    }
  );

  return {
    issueKey,
    commentId: response.id,
    message: `Successfully added comment to ${issueKey}`,
    url: `${getJiraConfig().baseUrl}/browse/${issueKey}`,
  };
}

export const jiraDataTool = new FunctionTool({
  name: "jiraCloudData",
  description:
    "Interact with Jira Cloud to create, read, update, delete issues and run searches via the REST API.",
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["getIssue", "searchIssues", "createIssue", "updateIssue", "deleteIssue"],
        description: "Choose the Jira action to perform.",
      },
      issueKey: {
        type: "string",
        description: "Issue key such as ABC-123. Required for getIssue, updateIssue, deleteIssue.",
      },
      jql: {
        type: "string",
        description: "JQL expression. Required for searchIssues.",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of issues to return when searching (1-50).",
      },
      summary: {
        type: "string",
        description: "Issue summary/title. Required for createIssue, optional for updateIssue.",
      },
      description: {
        type: "string",
        description: "Issue description. Optional for createIssue and updateIssue.",
      },
      issueType: {
        type: "string",
        description: "Issue type (e.g., Story, Task, Bug, Epic). Default is Story for createIssue.",
      },
      assignee: {
        type: "string",
        description: "Username or email of the assignee. Optional for createIssue and updateIssue.",
      },
      status: {
        type: "string",
        description: "Status to transition to (e.g., In Progress, Done, To Do). Optional for updateIssue.",
      },
      comment: {
        type: "string",
        description: "Comment text to add to an issue. Required for addComment.",
      },
    }, comment } =
      rawInput as JiraToolParams;

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

    if (operation === "createIssue") {
      return createIssue(summary || "", description || "", issueType, assignee);
    }

    if (operation === "updateIssue") {
      if (!issueKey) {
        throw new Error("issueKey is required when operation is updateIssue.");
      }
      return updateIssue(issueKey, summary, description, status, assignee);
    }

    if (operation === "deleteIssue") {
      if (!issueKey) {
        throw new Error("issueKey is required when operation is deleteIssue.");
      }
      return deleteIssue(issueKey);
    }

    if (operation === "addComment") {
      if (!issueKey) {
        throw new Error("issueKey is required when operation is addComment.");
      }
      if (!comment) {
        throw new Error("comment is required when operation is addComment.");
      }
      return addComment(issueKey, commente") {
      if (!issueKey) {
        throw new Error("issueKey is required when operation is deleteIssue.");
      }
      return deleteIssue(issueKey);
    }

    throw new Error(`Unsupported Jira operation: ${operation}`);
  },
});
