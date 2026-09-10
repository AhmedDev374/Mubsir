import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { mdsvex } from 'mdsvex';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

const basePath = (process.env.BASE_PATH || '') as '' | `/${string}`;

/**
 * Tesseract language data must live at a STABLE url — the OCR worker fetches
 * `${langPath}/eng.traineddata.gz` by convention, so a hashed `?url` asset
 * cannot work. (Passing bytes directly via `{code, data}` lang objects is
 * broken in tesseract.js ≤7: `initialize` uses `l.data` as the language
 * *name*.) Emitting from node_modules keeps the 3 MB binary out of git.
 */
function tessdataPlugin(): Plugin {
	const require = createRequire(import.meta.url);
	const source = require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
	return {
		name: 'voicebook-tessdata',
		configureServer(server) {
			server.middlewares.use(`${basePath}/tessdata/eng.traineddata.gz`, (_req, res) => {
				res.setHeader('Content-Type', 'application/gzip');
				res.end(readFileSync(source));
			});
		},
		generateBundle() {
			if (this.environment?.name === 'ssr') return;
			this.emitFile({
				type: 'asset',
				fileName: 'tessdata/eng.traineddata.gz',
				source: readFileSync(source)
			});
		}
	};
}

function localModelsPlugin(): Plugin {
	const root = join(process.cwd(), 'local_voice', 'models');
	const llmFiles = [
		'llm/LFM2.5-1.2B-Instruct-ONNX/config.json',
		'llm/LFM2.5-1.2B-Instruct-ONNX/generation_config.json',
		'llm/LFM2.5-1.2B-Instruct-ONNX/tokenizer_config.json',
		'llm/LFM2.5-1.2B-Instruct-ONNX/tokenizer.json',
		'llm/LFM2.5-1.2B-Instruct-ONNX/onnx/model_q4f16.onnx',
		'llm/LFM2.5-1.2B-Instruct-ONNX/onnx/model_q4f16.onnx_data'
	];
	const kemetoneFiles = [
		'tts/Rabe3-kemetone/config.json',
		'tts/Rabe3-kemetone/kemetone.pth',
		'tts/Rabe3-kemetone/voices/kemetone.pt',
		'tts/Rabe3-kemetone/kemetone/__init__.py',
		'tts/Rabe3-kemetone/kemetone/arabic.py',
		'tts/Rabe3-kemetone/kemetone/g2p.py',
		'tts/Rabe3-kemetone/kemetone/normalize_tashkeel.py',
		'tts/Rabe3-kemetone/kemetone/runtime.py',
		'tts/Rabe3-kemetone/kemetone/lexicons/ث.tsv',
		'tts/Rabe3-kemetone/kemetone/lexicons/ذ.tsv',
		'tts/Rabe3-kemetone/kemetone/lexicons/ظ.tsv',
		'tts/Rabe3-kemetone/kemetone/lexicons/ق.tsv'
	];
	const files = [
		'tts/Supertone-supertonic-3/onnx/tts.json',
		'tts/Supertone-supertonic-3/onnx/unicode_indexer.json',
		'tts/Supertone-supertonic-3/onnx/duration_predictor.onnx',
		'tts/Supertone-supertonic-3/onnx/text_encoder.onnx',
		'tts/Supertone-supertonic-3/onnx/vector_estimator.onnx',
		'tts/Supertone-supertonic-3/onnx/vocoder.onnx',
		...['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'].map(
			(voice) => `tts/Supertone-supertonic-3/voice_styles/${voice}.json`
		)
	];
	return {
		name: 'voicebook-local-models',
		configureServer(server) {
			server.middlewares.use('/local-models/', (request, response) => {
				const requested = decodeURIComponent((request.url ?? '').replace(/^\/+/, ''));
				if (requested === 'manifest.json') {
					const supertonicReady = files.every((file) => existsSync(join(root, file)));
					const llmReady = llmFiles.every((file) => existsSync(join(root, file)));
					const kemetoneReady = kemetoneFiles.every((file) => existsSync(join(root, file)));
					response.setHeader('Content-Type', 'application/json');
					response.end(JSON.stringify({ supertonicReady, llmReady, kemetoneReady }));
					return;
				}
				const safePath = normalize(join(root, requested));
				if (!safePath.startsWith(`${root}${requested ? '\\' : ''}`) || !existsSync(safePath)) {
					response.statusCode = 404;
					response.end('Not found');
					return;
				}
				response.setHeader('Content-Length', String(statSync(safePath).size));
				response.setHeader('Content-Type', requested.endsWith('.json') ? 'application/json' : 'application/octet-stream');
				createReadStream(safePath).pipe(response);
			});
		}
	};
}

export default defineConfig({
	// transformers.js loads its ONNX/WASM backends dynamically at runtime;
	// pre-bundling breaks those dynamic imports inside the LLM worker. The
	// liteparse wasm-bindgen glue resolves its .wasm beside itself the same
	// way.
	optimizeDeps: { exclude: ['@huggingface/transformers', '@llamaindex/liteparse-wasm'] },
	// Module workers (tts.worker.ts, llm/worker.ts) must be emitted as ES
	// modules — the classic-worker default cannot use import statements.
	worker: { format: 'es' },
	plugins: [
		tessdataPlugin(),
		localModelsPlugin(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({ fallback: '404.html' }),
			paths: { base: basePath },
			serviceWorker: { register: false },
			preprocess: [mdsvex({ extensions: ['.svx', '.md'] })],
			extensions: ['.svelte', '.svx', '.md']
		})
	],
	test: {
		expect: { requireAssertions: true },
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'json-summary', 'html'],
			include: [
				'src/lib/domain/annotations.ts',
				'src/lib/domain/assistant-context.ts',
				'src/lib/domain/document-lens.ts',
				'src/lib/domain/docx-extras.ts',
				'src/lib/domain/explain-prompts.ts',
				'src/lib/domain/importers.ts',
				'src/lib/domain/model-catalog.ts',
				'src/lib/domain/pages.ts',
				'src/lib/domain/page-tone.ts',
				'src/lib/domain/pdf-layout.ts',
				'src/lib/domain/pdf-markdown.ts',
				'src/lib/domain/segmenter.ts',
				'src/lib/domain/study-tree.ts',
				'src/lib/domain/tex-macros.ts',
				'src/lib/services/web-research.ts',
				'src/lib/domain/speech-words.ts',
				'src/lib/domain/web-article.ts',
				'src/lib/services/generation-plan.ts',
				'src/lib/services/repository.ts',
				'src/lib/services/timeline.ts',
				'src/lib/services/tts-client.ts'
			],
			thresholds: { lines: 85, functions: 85, statements: 85, branches: 80 }
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
