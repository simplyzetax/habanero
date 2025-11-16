import { db } from "./db/client";
import { getClientCredentials } from "./utils/auth";
import { CloudStorage } from "./utils/cloudstorage";
import { HOTFIXES } from "./db/schemas/hotfixes";
import { eq } from "drizzle-orm";
import { pushHotfixFile } from "./utils/github";

export default {
    async fetch(): Promise<Response> {
        return new Response("Hello World!");
    },

    async scheduled(controller): Promise<void> {
        try {
            switch (controller.cron) {
                case "0 0 * * *": {

                    const accessToken = await getClientCredentials();

                    // I know await in a for loop is not efficient but I like my clean code okay?
                    // Oh also I do not care about the performance of this
                    const cloudStorage = new CloudStorage(accessToken);
                    const hotfixes = await cloudStorage.getHotfixList();
                    for (const hotfix of hotfixes) {
                        const [existingHotfix] = await db.select().from(HOTFIXES).where(eq(HOTFIXES.hash256, hotfix.hash256));
                        if (existingHotfix) {
                            console.warn(`Hotfix ${hotfix.filename} already exists in database, skipping...`);
                            continue;
                        }

                        const contents = await cloudStorage.getContentsByUniqueFilename(hotfix.uniqueFilename);
                        if (contents.length !== 0) {
                            console.log(`Inserting hotfix ${hotfix.filename} into database`);
                            await db.insert(HOTFIXES).values({
                                ...hotfix,
                                contents,
                            });
                            console.log(`Pushing hotfix ${hotfix.filename} to GitHub`);
                            await pushHotfixFile("simplyzetax", "habanero", `hotfixes/${hotfix.filename}.ini`, contents);
                            console.log(`Hotfix ${hotfix.filename} pushed to GitHub`);
                        }
                    }
                    break;
                }
                default:
                    console.log(`Unknown cron: ${controller.cron}`);
            }
        } catch (error) {
            console.error("Error in scheduled function:", error);
            throw error;
        }
    },
} satisfies ExportedHandler<Env>;
