declare module "@earendil-works/pi-coding-agent" {
	export type ProviderModelConfig = {
		id: string;
		name: string;
		api: string;
		reasoning: boolean;
		input: ("text" | "image")[];
		cost: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
		};
		contextWindow: number;
	};

	export interface ExtensionAPI {
		registerProvider(
			name: string,
			config: {
				baseUrl: string;
				api: string;
				apiKey: string;
				models: ProviderModelConfig[];
			},
		): void;
	}
}
