import { errors } from "./errors";
import { insertHotfixSchema, NewHotfix } from "../db/schemas/hotfixes";
import { z } from "zod";

export class CloudStorage {
    constructor(public readonly accessToken: string) {
    }
    public async getHotfixList(): Promise<z.infer<typeof insertHotfixSchema>[]> {
        const response = await fetch("https://fngw-mcp-gc-livefn.ol.epicgames.com/fortnite/api/cloudstorage/system", {
            headers: {
                "Authorization": `Bearer ${this.accessToken}`,
            },
        });

        if (!response.ok) {
            switch (response.status) {
                case 401:
                    throw errors.unauthorized.withMessage("Invalid or expired access token");
                case 502:
                case 503:
                    throw errors.badGateway.withMessage("Fortnite cloud storage API is unavailable");
                default:
                    if (response.status >= 500) {
                        throw errors.serviceUnavailable.withMessage("Fortnite cloud storage service error");
                    } else {
                        throw errors.badRequest.withMessage(`Failed to fetch cloud storage: ${response.statusText}`);
                    }
            }
        }

        const data = await response.json();
        const parsedData = insertHotfixSchema.array().safeParse(data);

        if (!parsedData.success) {
            throw errors.badRequest.withMessage(`Failed to parse cloud storage data: ${parsedData.error.message}`);
        }

        return parsedData.data;
    }

    public async getContentsByUniqueFilename(uniqueFilename: string): Promise<string> {
        const response = await fetch(`https://fngw-mcp-gc-livefn.ol.epicgames.com/fortnite/api/cloudstorage/system/${uniqueFilename}`, {
            headers: {
                "Authorization": `Bearer ${this.accessToken}`,
            },
        });

        if (!response.ok) {
            throw errors.badRequest.withMessage(`Failed to fetch cloud storage contents: ${response.statusText}`);
        }

        return await response.text();
    }
}