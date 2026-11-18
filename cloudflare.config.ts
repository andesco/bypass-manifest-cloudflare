import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
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
