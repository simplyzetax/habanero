export default {
    async scheduled(controller, env, ctx): Promise<void> {
        const workflowRun = await env.HABANERO.create();
        console.log(`Started workflow run: ${workflowRun.id}`);
    },
} satisfies ExportedHandler<Env>;

export { HabaneroWorkflow } from "./workflows/Habanero";