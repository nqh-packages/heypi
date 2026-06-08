/** Maximum inbound audio size for local STT jobs. */
export const STT_MAX_BYTES = 25_000_000;

/** Maximum wall-clock time for ffmpeg and whisper subprocesses. */
export const STT_TIMEOUT_MS = 300_000;

export type SttResult = { ok: true; text: string } | { ok: false; reason: string };

export type SttLocalConfig = {
	binary?: string;
	ffmpeg?: string;
	modelPath?: string;
	language?: string;
	command?: string;
	maxBytes?: number;
	timeoutMs?: number;
};

export type SttConfig =
	| boolean
	| {
			enabled?: boolean;
			local?: SttLocalConfig;
	  };

export type SttCommandContext = {
	inputPath: string;
	outputDir: string;
	outputPath: string;
	language: string;
	model: string;
	format: string;
};

export const STT_PLACEHOLDERS = ["input_path", "output_dir", "output_path", "language", "model", "format"] as const;

export type SttPlaceholder = (typeof STT_PLACEHOLDERS)[number];
