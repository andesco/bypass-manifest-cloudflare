// Public template with placeholder values.
//
// To deploy with your own domain, KV namespace and upstream URL, create a
// gitignored `cloudflare.local.config.ts` next to this file with the same default
// export. When it exists it replaces this config. Only a missing file is ignored;
// any error inside it (syntax, missing import) stops the deploy instead of
// silently deploying these placeholders.
import { bindings, defineConfig, triggers } from "cf/config";

const template = defineConfig({
	worker: {
		name: "bypass-manifest-cloudflare",
		compatibilityDate: "2026-05-27",
		entrypoint: "src/index.js",
		workersDev: true,
		observability: {
			enabled: true,
			headSamplingRate: 1,
		},
		triggers: [
			triggers.scheduled({
				schedule: "0 */6 * * *",
			}),
		],
		env: {
			GIT_REPOSITORY_URL: bindings.text("https://git.example.com/project/{username}/{repository}/"),
			PUBLIC_BASE_URL: bindings.text("https://bypass.example.com"),
			Bypass_KV: bindings.kv({
				id: "your-kv-namespace-id",
			}),
		},
	},
});

const local = await import("./cloudflare.local.config.ts")
	.then((module) => module.default)
	.catch((error) => {
		if (error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message).includes("cloudflare.local.config")) return null;
		throw error;
	});

export default local ?? template;
