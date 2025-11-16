import { Octokit } from "@octokit/core";

const OWNER = "simplyzetax";
const REPO = "habanero";

export class GitHub {
    constructor(private octokit: Octokit) { }

    async ensureBranch(branchName: string): Promise<void> {
        try {
            await this.octokit.request("GET /repos/{owner}/{repo}/git/ref/heads/{ref}", {
                owner: OWNER,
                repo: REPO,
                ref: branchName,
            });
            // Branch exists, nothing to do
        } catch (err: any) {
            if (err.status === 404) {
                // Create an orphan branch (empty branch) by creating a new tree and commit
                // First, create an empty tree
                const { data: emptyTree } = await this.octokit.request("POST /repos/{owner}/{repo}/git/trees", {
                    owner: OWNER,
                    repo: REPO,
                    tree: [],
                });

                // Create a commit with the empty tree
                const { data: commit } = await this.octokit.request("POST /repos/{owner}/{repo}/git/commits", {
                    owner: OWNER,
                    repo: REPO,
                    message: `Initialize ${branchName} branch`,
                    tree: emptyTree.sha,
                });

                // Create the branch reference pointing to the empty commit
                await this.octokit.request("POST /repos/{owner}/{repo}/git/refs", {
                    owner: OWNER,
                    repo: REPO,
                    ref: `refs/heads/${branchName}`,
                    sha: commit.sha,
                });
            } else {
                throw err;
            }
        }
    }

    async pushFile(
        path: string,
        content: string,
        message: string,
        branch: string
    ): Promise<{ skipped?: boolean; success?: boolean; branch: string; filename?: string }> {
        let sha: string | undefined;

        try {
            const { data } = await this.octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
                owner: OWNER,
                repo: REPO,
                path,
                ref: branch,
            });

            if (!Array.isArray(data) && data.type === 'file' && 'content' in data && data.content) {
                sha = data.sha;
                const existingContent = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString();
                if (existingContent === content) {
                    return { skipped: true, branch };
                }
            } else if (!Array.isArray(data)) {
                sha = data.sha;
            }
        } catch (err: any) {
            if (err.status !== 404) throw err;
        }

        await this.octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
            owner: OWNER,
            repo: REPO,
            path,
            message,
            content: Buffer.from(content).toString('base64'),
            sha,
            branch,
        });

        return { success: true, branch };
    }

    async pushHotfixToBranches(
        filename: string,
        contents: string,
        version: string,
        branches: string[]
    ): Promise<{ success: true; filename: string; version: string }> {
        const path = `hotfixes/${filename}.ini`;
        const message = `Update hotfix ${filename} for version ${version}`;

        for (const branch of branches) {
            await this.pushFile(path, contents, message, branch);
        }

        return { success: true, filename, version };
    }

    async pushReadme(branch: string, content: string, message: string): Promise<void> {
        let sha: string | undefined;

        try {
            const { data } = await this.octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
                owner: OWNER,
                repo: REPO,
                path: "README.md",
                ref: branch,
            });

            if (!Array.isArray(data) && data.type === 'file' && 'sha' in data) {
                sha = data.sha;
            }
        } catch (err: any) {
            if (err.status !== 404) throw err;
        }

        await this.octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
            owner: OWNER,
            repo: REPO,
            path: "README.md",
            message,
            content: Buffer.from(content).toString('base64'),
            sha,
            branch,
        });
    }
}
