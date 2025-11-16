import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { ClientCredentials } from "simple-oauth2";
import { CloudStorage } from "../utils/cloudstorage";
import { HOTFIXES } from "../db/schemas/hotfixes";
import { eq } from "drizzle-orm";
import { fortniteVersionRequest } from "../utils/epicgames";
import { drizzle } from "drizzle-orm/d1";
import { Octokit } from "@octokit/core";
import { getClientCredentials } from "../utils/auth";

const CLIENT_ID = "ec684b8c687f479fadea3cb2ad83f5c6";
const CLIENT_SECRET = "e1f31c211f28413186262d37a13fc84d";

const oauth2Config = {
    client: {
        id: CLIENT_ID,
        secret: CLIENT_SECRET,
    },
    auth: {
        tokenHost: "https://account-public-service-prod.ol.epicgames.com",
        tokenPath: "/account/api/oauth/token",
    },
    http: {
        json: "strict" as const,
    },
};

export class HabaneroWorkflow extends WorkflowEntrypoint<Env> {

    async run(event: WorkflowEvent<Env>, step: WorkflowStep) {

        const accessToken = await step.do(
            'get-client-credentials',
            {
                retries: {
                    limit: 3,
                    delay: '2 second',
                    backoff: 'exponential',
                },
                timeout: '2 minutes',
            },
            async () => {
                return await getClientCredentials();
            },
        );

        const cloudstorage = new CloudStorage(accessToken);

        const fortniteVersion = await step.do(
            'get-fortnite-version',
            {
                retries: {
                    limit: 5,
                    delay: '3 second',
                    backoff: 'exponential',
                },
                timeout: '5 minutes',
            },
            async () => {
                return await fortniteVersionRequest(accessToken);
            },
        );

        const hotfixes = await step.do(
            'get-hotfix-list',
            {
                retries: {
                    limit: 5,
                    delay: '3 second',
                    backoff: 'exponential',
                },
                timeout: '5 minutes',
            },
            async () => {
                return await cloudstorage.getHotfixList();
            },
        );

        await step.do(
            'process-all-hotfixes',
            {
                retries: {
                    limit: 3,
                    delay: '5 second',
                    backoff: 'exponential',
                },
            },
            async () => {
                for (const hotfix of hotfixes) {
                    await step.do(
                        `process-hotfix-${hotfix.filename}`,
                        {
                            retries: {
                                limit: 3,
                                delay: '5 second',
                                backoff: 'exponential',
                            },
                            timeout: '10 minutes',
                        },
                        async () => {
                            const db = drizzle(this.env.D1);

                            const [existingHotfix] = await db
                                .select()
                                .from(HOTFIXES)
                                .where(eq(HOTFIXES.hash256, hotfix.hash256))
                                .limit(1);

                            if (existingHotfix) {
                                console.warn(`Hotfix ${hotfix.filename} already exists in database, skipping...`);
                                return { success: false, filename: hotfix.filename, version: fortniteVersion.version, reason: 'already exists' };
                            }

                            const contents = await step.do(
                                `fetch-hotfix-contents-${hotfix.filename}`,
                                {
                                    retries: {
                                        limit: 3,
                                        delay: '3 second',
                                        backoff: 'exponential',
                                    },
                                    timeout: '5 minutes',
                                },
                                async () => {
                                    return await cloudstorage.getContentsByUniqueFilename(hotfix.uniqueFilename);
                                },
                            );

                            if (contents.length === 0) {
                                console.warn(`Hotfix ${hotfix.filename} has empty contents, skipping...`);
                                return { success: false, filename: hotfix.filename, version: fortniteVersion.version, reason: 'empty contents' };
                            }

                            await step.do(
                                `insert-hotfix-to-db-${hotfix.filename}`,
                                {
                                    retries: {
                                        limit: 3,
                                        delay: '2 second',
                                        backoff: 'exponential',
                                    },
                                    timeout: '2 minutes',
                                },
                                async () => {
                                    const db = drizzle(this.env.D1);
                                    const [existing] = await db
                                        .select()
                                        .from(HOTFIXES)
                                        .where(eq(HOTFIXES.hash256, hotfix.hash256))
                                        .limit(1);

                                    if (existing) {
                                        console.warn(`Hotfix ${hotfix.filename} was inserted by another process, skipping insert...`);
                                        return { success: false, filename: hotfix.filename, version: fortniteVersion.version, reason: 'already exists' };
                                    }

                                    await db.insert(HOTFIXES).values({
                                        ...hotfix,
                                        contents,
                                        version: fortniteVersion.version,
                                    });
                                },
                            );

                            await step.do(
                                `push-hotfix-to-github-${hotfix.filename}`,
                                {
                                    retries: {
                                        limit: 5,
                                        delay: '5 second',
                                        backoff: 'exponential',
                                    },
                                    timeout: '5 minutes',
                                },
                                async () => {
                                    const octokit = new Octokit({ auth: this.env.GITHUB_API_TOKEN });
                                    let sha: string | undefined;

                                    try {
                                        const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
                                            owner: "simplyzetax",
                                            repo: "habanero",
                                            path: `hotfixes/${hotfix.filename}.ini`,
                                        });

                                        if (Array.isArray(data)) {
                                            sha = undefined;
                                        } else if (data.type === 'file' && 'content' in data && data.content) {
                                            sha = data.sha;
                                            const existingContent = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString();
                                            if (existingContent === contents) {
                                                console.log(`Hotfix ${hotfix.filename} already exists in GitHub with same content, skipping...`);
                                                return { success: true, filename: hotfix.filename, version: fortniteVersion.version, reason: 'already exists' };
                                            }
                                        } else {
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

                                    return { success: true, filename: hotfix.filename, version: fortniteVersion.version };
                                },
                            );

                            return {
                                success: true,
                                filename: hotfix.filename,
                                version: fortniteVersion.version,
                            };
                        },
                    );
                }
            },
        );
    }
}