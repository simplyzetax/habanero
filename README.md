# Habanero

Habanero is a Cloudflare Worker that automatically syncs Fortnite hotfixes from the Epic Games API. It runs on a scheduled cron job to fetch the latest hotfix files and stores them in a D1 database and github repository for easy access and version tracking.

## Tracked Versions

The master branch is the default branch and contains the latest version of the hotfixes, so does the specific latest version branch.

- [version-38.10](https://github.com/simplyzetax/habanero/tree/version-38.10)
- [version-38.11](https://github.com/simplyzetax/habanero/tree/version-38.11)

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
   ```bash
   pnpm install
   ```

2. Configure your Cloudflare bindings in `wrangler.jsonc`:
   - KV namespace for caching credentials
   - D1 database for hotfix storage
   - Workflow bindings

3. Run database migrations:
   ```bash
   pnpm drizzle-kit migrate
   ```

4. Start the development server:
   ```bash
   pnpm dev
   ```

### Deployment

Deploy to Cloudflare Workers:
```bash
pnpm run deploy
```
## Cron Schedule

The worker runs on a 30-minute interval (`*/30 * * * *`) to check for new hotfixes and sync them to the database and git repository.