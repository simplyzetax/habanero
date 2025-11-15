import { env } from "cloudflare:workers";
import { ClientCredentials } from "simple-oauth2";
import { errors } from "./errors";

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

export async function getClientCredentials(): Promise<string> {
    const client = new ClientCredentials(oauth2Config);

    const cachedTokenJson = await env.KV.get("client_credentials");
    if (cachedTokenJson) {
        const cachedToken = client.createToken(JSON.parse(cachedTokenJson));

        if (!cachedToken.expired(60) && typeof cachedToken.token.access_token === "string") {
            return cachedToken.token.access_token;
        }
    }

    const accessToken = await client.getToken({});
    const tokenData = accessToken.token;
    const expiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600; // Default to 1 hour if not provided

    await env.KV.put("client_credentials", JSON.stringify(tokenData), {
        expirationTtl: expiresIn,
    });

    const accessTokenString = tokenData.access_token;
    if (typeof accessTokenString !== "string") {
        throw new Error("Invalid token response: access_token is not a string");
    }

    return accessTokenString;
}