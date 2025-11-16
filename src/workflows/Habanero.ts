import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { CloudStorage } from "../utils/cloudstorage";
import { HOTFIXES } from "../db/schemas/hotfixes";
import { eq } from "drizzle-orm";
import { fortniteVersionRequest } from "../utils/epicgames";
import { drizzle } from "drizzle-orm/d1";
import { Octokit } from "@octokit/core";
import { getClientCredentials } from "../utils/auth";

const retryConfig = { retries: { limit: 3, delay: '3 second' as const, backoff: 'exponential' as const } };

export class HabaneroWorkflow extends WorkflowEntrypoint<Env> {
    async run(event: WorkflowEvent<Env>, step: WorkflowStep) {
        const accessToken = await step.do('get-client-credentials', retryConfig, getClientCredentials);
        const fortniteVersion = await step.do('get-fortnite-version', retryConfig, () => fortniteVersionRequest(accessToken));
        const hotfixes = await step.do('get-hotfix-list', retryConfig, () => CloudStorage.getHotfixList(accessToken));

        await step.do('process-all-hotfixes', retryConfig, async () => {
            for (const hotfix of hotfixes) {
                await step.do(`process-hotfix-${hotfix.filename}`, retryConfig, async () => {
                    const db = drizzle(this.env.D1);
                    const [existing] = await db.select().from(HOTFIXES).where(eq(HOTFIXES.hash256, hotfix.hash256)).limit(1);
                    if (existing) return;

                    const contents = await step.do(`fetch-hotfix-contents-${hotfix.filename}`, retryConfig, () =>
                        CloudStorage.getContentsByUniqueFilename(accessToken, hotfix.uniqueFilename)
                    );

                    await step.do(`insert-hotfix-to-db-${hotfix.filename}`, retryConfig, async () => {
                        await db.insert(HOTFIXES).values({ ...hotfix, contents, version: fortniteVersion.version });
                    });

                    await step.do(`push-hotfix-to-github-${hotfix.filename}`, retryConfig, async () => {
                        const octokit = new Octokit({ auth: this.env.GITHUB_API_TOKEN });
                        let sha: string | undefined;

                        try {
                            const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
                                owner: "simplyzetax",
                                repo: "habanero",
                                path: `hotfixes/${hotfix.filename}.ini`,
                            });

                            if (!Array.isArray(data) && data.type === 'file' && 'content' in data && data.content) {
                                sha = data.sha;
                                const existingContent = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString();
                                if (existingContent === contents) return;
                            } else if (!Array.isArray(data)) {
                                sha = data.sha;
                            }

                        } catch (err: any) {
                            if (err.status !== 404) throw err;
                        }

                        await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
                            owner: "simplyzetax",
                            repo: "habanero",
                            path: `hotfixes/${hotfix.filename}.ini`,
                            message: `Update hotfix ${hotfix.filename} for version ${fortniteVersion.version}`,
                            content: Buffer.from(contents).toString('base64'),
                            sha,
                        });
                    });
                });
            }
        });
    }
}