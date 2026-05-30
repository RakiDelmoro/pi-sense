/**
 * Local type declarations for @earendil-works/pi-coding-agent
 * Covers only the types used by our PPQ provider extension.
 */
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
