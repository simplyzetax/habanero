import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { CloudStorage } from "../utils/cloudstorage";
import { HOTFIXES } from "../db/schemas/hotfixes";
import { eq, sql } from "drizzle-orm";
import { fortniteVersionRequest } from "../utils/epicgames";
import { drizzle } from "drizzle-orm/d1";
import { Octokit } from "@octokit/core";
import { getClientCredentials } from "../utils/auth";
import { errors, WorkflowResult } from "../utils/errors";
import { GitHub } from "../utils/github";

const retryConfig = { retries: { limit: 3, delay: '3 second' as const, backoff: 'exponential' as const } };

export class HabaneroWorkflow extends WorkflowEntrypoint<Env> {
    async run(event: WorkflowEvent<Env>, step: WorkflowStep) {
        const accessToken = await step.do('get-client-credentials', retryConfig, getClientCredentials);
        const fortniteVersion = await step.do('get-fortnite-version', retryConfig, () => fortniteVersionRequest(accessToken));
        const hotfixes = await step.do('get-hotfix-list', retryConfig, () => CloudStorage.getHotfixList(accessToken));

        const branchName = `version-${fortniteVersion.version}`;
        const versionReadme = `Hotfixes for version ${fortniteVersion.version}`;

        await step.do('ensure-version-branch', retryConfig, async () => {
            const github = new GitHub(new Octokit({ auth: this.env.GITHUB_API_TOKEN }));
            await github.ensureBranch(branchName, versionReadme);
        });

        await step.do('push-version-readme', retryConfig, async () => {
            const github = new GitHub(new Octokit({ auth: this.env.GITHUB_API_TOKEN }));
            await github.pushReadme(
                branchName,
                versionReadme,
                `Update README for version ${fortniteVersion.version}`
            );
        });

        const newHotfixes = await step.do('process-all-hotfixes', retryConfig, async () => {
            const db = drizzle(this.env.D1);
            const hotfixesToPush: Array<{ filename: string; contents: string }> = [];

            for (const hotfix of hotfixes) {
                const [existing] = await db.select().from(HOTFIXES).where(eq(HOTFIXES.hash256, hotfix.hash256)).limit(1);
                if (existing) continue;

                const contents = await CloudStorage.getContentsByUniqueFilename(accessToken, hotfix.uniqueFilename);
                await db.insert(HOTFIXES).values({ ...hotfix, contents, version: fortniteVersion.version });

                hotfixesToPush.push({ filename: hotfix.filename, contents });
            }

            return hotfixesToPush;
        });

        if (newHotfixes.length > 0) {
            await step.do('push-all-hotfixes-to-github', retryConfig, async () => {
                const github = new GitHub(new Octokit({ auth: this.env.GITHUB_API_TOKEN }));
                await github.pushMultipleHotfixesToBranches(
                    newHotfixes,
                    fortniteVersion.version,
                    [branchName, 'master']
                );
            });
        }

        await step.do('update-master-readme', retryConfig, async () => {
            const db = drizzle(this.env.D1);
            const versions = await db
                .select({ version: HOTFIXES.version })
                .from(HOTFIXES)
                .where(sql`${HOTFIXES.version} IS NOT NULL AND ${HOTFIXES.version} != 'unknown'`)
                .groupBy(HOTFIXES.version)
                .orderBy(HOTFIXES.version);

            const versionList = versions.map(v => `- [version-${v.version}](https://github.com/simplyzetax/habanero/tree/version-${v.version})`).join('\n');

            const masterReadme = `# Habanero

Habanero is a Cloudflare Worker that automatically syncs Fortnite hotfixes from the Epic Games API. It runs on a scheduled cron job to fetch the latest hotfix files and stores them in a D1 database and github repository for easy access and version tracking.

## Tracked Versions

The master branch is the default branch and contains the latest version of the hotfixes, so does the specific latest version branch.

${versionList}

## Features

- Automated hotfix synchronization via cron triggers
- Stores hotfix metadata and contents in D1 database
- Handles authentication with Epic Games API
- Batch processing to handle large datasets efficiently
- Conflict resolution for duplicate entries

## Architecture

- **Cloudflare Workers**: Serverless runtime for scheduled tasks
- **D1 Database**: SQLite database for storing hotfix data
- **Drizzle ORM**: Type-safe database queries and migrations
- **Workflows**: Long-running processes using Cloudflare Durable Objects

## Development

### Prerequisites

- Node.js 18 or later
- pnpm package manager
- Cloudflare account with Workers and D1 enabled

### Setup

1. Install dependencies:
   \`\`\`bash
   pnpm install
   \`\`\`

2. Configure your Cloudflare bindings in \`wrangler.jsonc\`:
   - KV namespace for caching credentials
   - D1 database for hotfix storage
   - Workflow bindings

3. Run database migrations:
   \`\`\`bash
   pnpm drizzle-kit migrate
   \`\`\`

4. Start the development server:
   \`\`\`bash
   pnpm dev
   \`\`\`

### Deployment

Deploy to Cloudflare Workers:
\`\`\`bash
pnpm run deploy
\`\`\`
## Cron Schedule

The worker runs on a 30-minute interval (\`*/30 * * * *\`) to check for new hotfixes and sync them to the database and git repository.`;

            const github = new GitHub(new Octokit({ auth: this.env.GITHUB_API_TOKEN }));
            await github.pushReadme(
                'master',
                masterReadme,
                `Update README with tracked versions`
            );
        });
    }
}