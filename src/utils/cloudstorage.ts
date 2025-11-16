import { errors } from "./errors";
import { insertHotfixSchema, NewHotfix } from "../db/schemas/hotfixes";
import { z } from "zod";

export class CloudStorage {
    static async getHotfixList(accessToken: string): Promise<z.infer<typeof insertHotfixSchema>[]> {
        const response = await fetch("https://fngw-mcp-gc-livefn.ol.epicgames.com/fortnite/api/cloudstorage/system", {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw errors.badRequest.withMessage(`Failed to fetch cloud storage data: ${response.statusText}`);
        }

        const data = await response.json();
        const parsedData = insertHotfixSchema.array().safeParse(data);

        if (!parsedData.success) {
            throw errors.badRequest.withMessage(`Failed to parse cloud storage data: ${parsedData.error.message}`);
        }

        return parsedData.data;
    }

    static async getContentsByUniqueFilename(accessToken: string, uniqueFilename: string): Promise<string> {
        const response = await fetch(`https://fngw-mcp-gc-livefn.ol.epicgames.com/fortnite/api/cloudstorage/system/${uniqueFilename}`, {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw errors.badRequest.withMessage(`Failed to fetch cloud storage contents: ${response.statusText}`);
        }

        return await response.text();
    }
}