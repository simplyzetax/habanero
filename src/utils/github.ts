import { Octokit } from "@octokit/core";
import { env } from 'cloudflare:workers';

const octokit = new Octokit({ auth: env.GITHUB_API_TOKEN });

export async function pushHotfixFile(owner: string, repo: string, path: string, content: string) {
    let sha: string | undefined;

    // Try to get the existing file SHA
    try {
        const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
            owner,
            repo,
            path
        });
        sha = Array.isArray(data) ? data[0]?.sha : data.sha;
    } catch (err: any) {
        if (err.status !== 404) throw err;
    }

    // Create or update the file
    await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
        owner,
        repo,
        path,
        message: sha ? `update ${path}` : `create ${path}`,
        content: btoa(content),
        sha
    });
}
