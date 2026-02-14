import { FunctionTool } from "@google/adk";

type GithubOperation = "getRepo" | "listPullRequests";

interface GithubToolParams {
	operation: GithubOperation;
	owner?: string;
	repo?: string;
	state?: "open" | "closed" | "all";
	perPage?: number;
}

interface GithubRepoResponse {
	name: string;
	full_name: string;
	description: string | null;
	stargazers_count: number;
	forks_count: number;
	open_issues_count: number;
	html_url: string;
	default_branch: string;
}

interface GithubPullRequestResponse {
	number: number;
	title: string;
	user: { login: string };
	state: string;
	html_url: string;
	created_at: string;
	updated_at: string;
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_DEFAULT_OWNER = process.env.GITHUB_DEFAULT_OWNER;
const GITHUB_DEFAULT_REPO = process.env.GITHUB_DEFAULT_REPO;

function getGithubHeaders() {
	if (!GITHUB_TOKEN) {
		throw new Error("GITHUB_TOKEN must be set in the environment.");
	}

	return {
		Accept: "application/vnd.github+json",
		Authorization: `Bearer ${GITHUB_TOKEN}`,
		"User-Agent": "directv-google-adk-agent",
	} satisfies HeadersInit;
}

async function githubRequest<T>(path: string): Promise<T> {
	const response = await fetch(`https://api.github.com${path}`, {
		headers: getGithubHeaders(),
	});

	if (!response.ok) {
		const details = await response.text();
		throw new Error(`GitHub request failed: ${response.status} ${details}`);
	}

	return (await response.json()) as T;
}

function resolveRepoTarget(owner?: string, repo?: string) {
	const resolvedOwner = (owner ?? GITHUB_DEFAULT_OWNER)?.trim();
	const resolvedRepo = (repo ?? GITHUB_DEFAULT_REPO)?.trim();

	if (!resolvedOwner || !resolvedRepo) {
		throw new Error(
			"GitHub owner and repo are required. Provide them in the tool input or configure GITHUB_DEFAULT_OWNER and GITHUB_DEFAULT_REPO."
		);
	}

	return { owner: resolvedOwner, repo: resolvedRepo };
}

async function fetchRepo(owner: string, repo: string) {
	const data = await githubRequest<GithubRepoResponse>(`/repos/${owner}/${repo}`);
	return {
		name: data.name,
		fullName: data.full_name,
		description: data.description,
		stars: data.stargazers_count,
		forks: data.forks_count,
		openIssues: data.open_issues_count,
		defaultBranch: data.default_branch,
		url: data.html_url,
	};
}

async function fetchPullRequests(owner: string, repo: string, state: "open" | "closed" | "all", perPage: number) {
	const size = Math.min(Math.max(perPage, 1), 50);
	const prs = await githubRequest<GithubPullRequestResponse[]>(
		`/repos/${owner}/${repo}/pulls?state=${state}&per_page=${size}`
	);
	const pullRequests = prs.map((pr) => ({
		number: pr.number,
		title: pr.title,
		author: pr.user.login,
		state: pr.state,
		url: pr.html_url,
		createdAt: pr.created_at,
		updatedAt: pr.updated_at,
	}));
	return {
		repository: `${owner}/${repo}`,
		state,
		total: pullRequests.length,
		pullRequests,
	};
}

export const githubDataTool = new FunctionTool({
	name: "githubRepoInsights",
	description: "Read GitHub repository metadata or pull requests using the REST API.",
	parameters: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				enum: ["getRepo", "listPullRequests"],
				description: "Choose whether to fetch repo info or pull requests.",
			},
			owner: {
				type: "string",
				description:
					"GitHub org or username that owns the repo. Optional if GITHUB_DEFAULT_OWNER is set.",
			},
			repo: {
				type: "string",
				description: "Repository name. Optional if GITHUB_DEFAULT_REPO is set.",
			},
			state: {
				type: "string",
				enum: ["open", "closed", "all"],
				description: "Pull request state filter (listPullRequests only).",
			},
			perPage: {
				type: "number",
				description: "Maximum pull requests to return (1-50).",
			},
		},
		required: ["operation"],
	},
	execute: async (rawInput) => {
		const { operation, owner, repo, state = "all", perPage = 20 } = rawInput as GithubToolParams;
		const { owner: resolvedOwner, repo: resolvedRepo } = resolveRepoTarget(owner, repo);

		if (operation === "getRepo") {
			return fetchRepo(resolvedOwner, resolvedRepo);
		}

		if (operation === "listPullRequests") {
			return fetchPullRequests(resolvedOwner, resolvedRepo, state, perPage);
		}

		throw new Error(`Unsupported GitHub operation: ${operation}`);
	},
});
