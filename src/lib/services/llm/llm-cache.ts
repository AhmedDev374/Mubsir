/**
 * Storage management for narration-model weights. transformers.js persists
 * every fetched file in the Cache Storage cache named 'transformers-cache',
 * keyed by its full download URL:
 *   https://huggingface.co/{modelId}/resolve/{revision}/…
 * Deletion therefore matches entries by hostname + path prefix — never by
 * substring, so sibling repositories can't be caught by accident.
 */

export const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

const REQUIRED_MODEL_FILES: Record<string, string[]> = {
	'LiquidAI/LFM2.5-1.2B-Instruct-ONNX': [
		'config.json',
		'generation_config.json',
		'tokenizer_config.json',
		'tokenizer.json',
		'onnx/model_q4f16.onnx'
	],
	'onnx-community/Qwen3.5-2B-ONNX': [
		'config.json',
		'generation_config.json',
		'tokenizer_config.json',
		'tokenizer.json',
		'onnx/model_q4f16.onnx'
	]
};

export async function deleteLlmModelAssets(modelId: string): Promise<void> {
	if (typeof caches === 'undefined') return;
	try {
		const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
		for (const request of await cache.keys()) {
			const url = new URL(request.url);
			if (url.hostname.endsWith('huggingface.co') && url.pathname.startsWith(`/${modelId}/`)) {
				await cache.delete(request);
			}
		}
	} catch {
		// Cache Storage unavailable (private mode, etc.) — nothing to clean.
	}
}

/** Whether all runtime-critical files for the model are present in the
 * persistent transformers cache. Used to reconcile the installed flag with
 * physical reality on boot. */
export async function hasLlmModelAssets(modelId: string): Promise<boolean> {
	if (typeof caches === 'undefined') return false;
	try {
		const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
		const paths = new Set(
			(await cache.keys())
				.filter((request) => {
					const url = new URL(request.url);
					return url.hostname.endsWith('huggingface.co') && url.pathname.startsWith(`/${modelId}/`);
				})
				.map((request) => new URL(request.url).pathname.split(`/resolve/`).at(-1))
		);
		const required = REQUIRED_MODEL_FILES[modelId];
		if (!required) return paths.size > 0;
		return required.every((file) => paths.has(`main/${file}`));
	} catch {
		// Fall through to false.
	}
	return false;
}
