import { z } from "zod";

const moduleSchema = z.object({
    cln: z.string(),
    build: z.string(),
    buildDate: z.iso.datetime(),
    version: z.string(),
    branch: z.string(),
});

export const fortniteVersionSchema = z.object({
    app: z.string(),
    serverDate: z.iso.datetime(),
    overridePropertiesVersion: z.string(),
    cln: z.string(),
    build: z.string(),
    moduleName: z.string(),
    buildDate: z.iso.datetime(),
    version: z.string(),
    branch: z.string(),
    modules: z.record(z.string(), moduleSchema),
});

export type FortniteVersion = z.infer<typeof fortniteVersionSchema>;

export async function fortniteVersionRequest(accessToken: string): Promise<FortniteVersion> {
    const response = await fetch("https://fngw-mcp-gc-livefn.ol.epicgames.com/fortnite/api/version", {
        headers: {
            "Authorization": `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get Fortnite version: ${response.statusText}`);
    }

    const data = await response.json();
    const validated = fortniteVersionSchema.parse(data);
    return validated;
}