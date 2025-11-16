import { Octokit } from "@octokit/core";

const OWNER = "simplyzetax";
const REPO = "habanero";

export class GitHub {
    constructor(private octokit: Octokit) { }

    async ensureBranch(branchName: string, initialReadmeContent?: string): Promise<void> {
        try {
            await this.octokit.request("GET /repos/{owner}/{repo}/git/ref/heads/{ref}", {
                owner: OWNER,
                repo: REPO,
                ref: branchName,
            });
            // Branch exists, nothing to do
        } catch (err: any) {
            if (err.status === 404) {
                // Create an orphan branch by creating a commit with just the README
                // GitHub doesn't allow empty trees, so we need at least one file
                const readmeContent = initialReadmeContent || `Hotfixes for version ${branchName.replace('version-', '')}`;

                // Create a blob for the README
                const { data: blob } = await this.octokit.request("POST /repos/{owner}/{repo}/git/blobs", {
                    owner: OWNER,
                    repo: REPO,
                    content: readmeContent,
                    encoding: 'utf-8',
                });

                // Create a tree with just the README
                const { data: tree } = await this.octokit.request("POST /repos/{owner}/{repo}/git/trees", {
                    owner: OWNER,
                    repo: REPO,
                    tree: [
                        {
                            path: 'README.md',
                            mode: '100644',
                            type: 'blob',
                            sha: blob.sha,
                        },
                    ],
                });

                // Create a commit with the tree (no parent = orphan branch)
                const { data: commit } = await this.octokit.request("POST /repos/{owner}/{repo}/git/commits", {
                    owner: OWNER,
                    repo: REPO,
                    message: `Initialize ${branchName} branch`,
                    tree: tree.sha,
                });

                // Create the branch reference pointing to the commit
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

    async pushMultipleHotfixesToBranches(
        hotfixes: Array<{ filename: string; contents: string }>,
        version: string,
        branches: string[]
    ): Promise<{ success: true; count: number; version: string }> {
        const files = hotfixes.map(h => ({
            path: `hotfixes/${h.filename}.ini`,
            content: h.contents,
        }));

        const message = `Update ${hotfixes.length} hotfix${hotfixes.length > 1 ? 'es' : ''} for version ${version}`;

        for (const branch of branches) {
            await this.pushMultipleFiles(files, message, branch);
        }

        return { success: true, count: hotfixes.length, version };
    }

    async pushMultipleFiles(
        files: Array<{ path: string; content: string }>,
        message: string,
        branch: string
    ): Promise<void> {
        // Get the current commit SHA for the branch
        const { data: refData } = await this.octokit.request("GET /repos/{owner}/{repo}/git/ref/heads/{ref}", {
            owner: OWNER,
            repo: REPO,
            ref: branch,
        });

        const currentCommitSha = refData.object.sha;

        // Get the current tree
        const { data: currentCommit } = await this.octokit.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", {
            owner: OWNER,
            repo: REPO,
            commit_sha: currentCommitSha,
        });

        const { data: currentTree } = await this.octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
            owner: OWNER,
            repo: REPO,
            tree_sha: currentCommit.tree.sha,
            recursive: 'true',
        });

        // Create a map of existing files for quick lookup
        const existingFiles = new Map<string, { sha: string; mode: string; type: string }>();
        if (currentTree.tree && Array.isArray(currentTree.tree)) {
            for (const item of currentTree.tree) {
                if (item.type === 'blob' && item.path) {
                    existingFiles.set(item.path, { sha: item.sha, mode: item.mode || '100644', type: item.type });
                }
            }
        }

        // Create blobs for all files
        const treeEntries: Array<{ path: string; mode: '100644' | '100755' | '040000' | '160000' | '120000'; type: 'blob' | 'tree' | 'commit'; sha: string }> = [];

        for (const file of files) {
            // Check if file exists and content is the same
            const existing = existingFiles.get(file.path);
            if (existing) {
                // Get the blob content to compare
                try {
                    const { data: blob } = await this.octokit.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", {
                        owner: OWNER,
                        repo: REPO,
                        file_sha: existing.sha,
                    });

                    const existingContent = Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf-8').toString();
                    if (existingContent === file.content) {
                        // Content is the same, keep existing blob
                        treeEntries.push({
                            path: file.path,
                            mode: (existing.mode || '100644') as '100644' | '100755' | '040000' | '160000' | '120000',
                            type: existing.type as 'blob' | 'tree' | 'commit',
                            sha: existing.sha,
                        });
                        continue;
                    }
                } catch (err) {
                    // If we can't get the blob, create a new one
                }
            }

            // Create a new blob for the file
            const { data: blob } = await this.octokit.request("POST /repos/{owner}/{repo}/git/blobs", {
                owner: OWNER,
                repo: REPO,
                content: file.content,
                encoding: 'utf-8',
            });

            treeEntries.push({
                path: file.path,
                mode: '100644',
                type: 'blob',
                sha: blob.sha,
            });
        }

        // Preserve existing files that aren't being updated
        if (currentTree.tree && Array.isArray(currentTree.tree)) {
            for (const item of currentTree.tree) {
                if (item.type === 'blob' && item.path) {
                    // Only preserve if we're not updating this file
                    if (!files.some(f => f.path === item.path)) {
                        treeEntries.push({
                            path: item.path,
                            mode: (item.mode || '100644') as '100644' | '100755' | '040000' | '160000' | '120000',
                            type: item.type as 'blob' | 'tree' | 'commit',
                            sha: item.sha,
                        });
                    }
                } else if (item.type === 'tree') {
                    // Preserve directories
                    treeEntries.push({
                        path: item.path!,
                        mode: (item.mode || '040000') as '100644' | '100755' | '040000' | '160000' | '120000',
                        type: item.type as 'blob' | 'tree' | 'commit',
                        sha: item.sha,
                    });
                }
            }
        }

        // Create a new tree with all files
        const { data: newTree } = await this.octokit.request("POST /repos/{owner}/{repo}/git/trees", {
            owner: OWNER,
            repo: REPO,
            tree: treeEntries,
            base_tree: currentCommit.tree.sha,
        });

        // Create a new commit
        const { data: newCommit } = await this.octokit.request("POST /repos/{owner}/{repo}/git/commits", {
            owner: OWNER,
            repo: REPO,
            message,
            tree: newTree.sha,
            parents: [currentCommitSha],
        });

        // Update the branch reference
        await this.octokit.request("PATCH /repos/{owner}/{repo}/git/refs/heads/{ref}", {
            owner: OWNER,
            repo: REPO,
            ref: branch,
            sha: newCommit.sha,
        });
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
