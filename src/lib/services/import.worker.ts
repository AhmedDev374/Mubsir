/// <reference lib="webworker" />

import type { ImportOptions, PdfImportProgress, importFile } from '$lib/domain/importers';

interface ImportRequest {
	type: 'import';
	file: File;
	fingerprint: string;
}

interface ProgressResponse {
	type: 'progress';
	progress: PdfImportProgress;
}

interface SuccessResponse {
	type: 'success';
	document: Awaited<ReturnType<typeof importFile>>;
}

interface ErrorResponse {
	type: 'error';
	message: string;
}

const worker = self as unknown as DedicatedWorkerGlobalScope;

async function installMarkdownDomShim(): Promise<void> {
	if (typeof document !== 'undefined') return;
	const { characterEntities } = await import('character-entities');
	const element = {
		textContent: '',
		set innerHTML(value: string) {
			this.textContent = value.replace(
				/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi,
				(match, reference: string) => {
					if (reference[0] === '#') {
						const codePoint = reference[1].toLowerCase() === 'x'
							? Number.parseInt(reference.slice(2), 16)
							: Number.parseInt(reference.slice(1), 10);
						return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
					}
					return characterEntities[reference] ?? match;
				}
			);
		}
	};
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: { createElement: () => element }
	});
}

worker.onmessage = async (event: MessageEvent<ImportRequest>) => {
	if (event.data?.type !== 'import') return;
	try {
		await installMarkdownDomShim();
		const { importFile } = await import('$lib/domain/importers');
		Reflect.deleteProperty(globalThis, 'document');
		const options: ImportOptions = {
			fingerprint: event.data.fingerprint,
			onProgress: (progress) => worker.postMessage({ type: 'progress', progress } satisfies ProgressResponse)
		};
		const document = await importFile(event.data.file, options);
		worker.postMessage({ type: 'success', document } satisfies SuccessResponse);
	} catch (error) {
		worker.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : 'The document could not be imported.'
		} satisfies ErrorResponse);
	}
};
