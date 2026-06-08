import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sttEnv } from "../../config.js";
import type { SttCommandContext, SttLocalConfig, SttPlaceholder, SttResult } from "./types.js";
import { STT_MAX_BYTES, STT_PLACEHOLDERS, STT_TIMEOUT_MS } from "./types.js";

const DISCOVERY_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];
const SHELL_METACHAR_RE = /[;|&`$<>()\n\r\0]|^\s*$|\$\(/;
const UNKNOWN_PLACEHOLDER_RE = /\{([^{}]+)\}/g;

export type ExecRunner = (file: string, args: string[], options: ExecRunnerOptions) => Promise<ExecRunnerResult>;

export type ExecRunnerOptions = {
	timeoutMs: number;
	maxBuffer?: number;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
};

export type ExecRunnerResult = {
	stdout: string;
	stderr: string;
	code: number;
};

export type TranscribeLocalInput = {
	audioPath: string;
	config?: SttLocalConfig;
	env?: NodeJS.ProcessEnv;
	runner?: ExecRunner;
};

/** Builds fixed argv for the default whisper.cpp invocation path. */
export function buildDefaultWhisperArgv(binary: string, ctx: SttCommandContext): string[] {
	return [binary, "-m", ctx.model, "-f", ctx.inputPath, "-l", ctx.language, "--output-txt", "-of", ctx.outputPath];
}

/** Builds fixed argv for ffmpeg audio normalization (16 kHz mono WAV). */
export function buildFfmpegArgv(inputPath: string, wavPath: string): string[] {
	return ["-i", inputPath, "-ar", "16000", "-ac", "1", "-y", wavPath];
}

/** Returns a failure reason when the template is unsafe; otherwise undefined. */
export function validateCommandTemplate(template: string): string | undefined {
	const trimmed = template.trim();
	if (!trimmed) return "custom STT command is empty";
	if (SHELL_METACHAR_RE.test(trimmed)) return "custom STT command contains shell metacharacters";
	for (const match of trimmed.matchAll(UNKNOWN_PLACEHOLDER_RE)) {
		const name = match[1];
		if (!name || !STT_PLACEHOLDERS.includes(name as SttPlaceholder)) {
			return `custom STT command contains unknown placeholder: {${name ?? ""}}`;
		}
	}
	return undefined;
}

/** Parses a custom command template into argv for execFile/spawn (no shell). */
export function parseCommandTemplate(template: string, ctx: SttCommandContext): string[] {
	const unsafe = validateCommandTemplate(template);
	if (unsafe) throw new Error(unsafe);
	const values: Record<SttPlaceholder, string> = {
		input_path: ctx.inputPath,
		output_dir: ctx.outputDir,
		output_path: ctx.outputPath,
		language: ctx.language,
		model: ctx.model,
		format: ctx.format,
	};
	const tokens = tokenizeTemplate(template.trim());
	return tokens.map((token) => {
		if (token.startsWith("{") && token.endsWith("}")) {
			const key = token.slice(1, -1) as SttPlaceholder;
			return values[key];
		}
		return token;
	});
}

/** Resolves custom STT command template from config or env (Hermes alias supported). */
export function resolveCustomCommand(config: SttLocalConfig | undefined, env: NodeJS.ProcessEnv): string | undefined {
	const fromConfig = config?.command?.trim();
	if (fromConfig) return fromConfig;
	const heypi = env.HEYPI_LOCAL_STT_COMMAND?.trim() || sttEnv.localCommand?.trim();
	if (heypi) return heypi;
	const hermes = env.HERMES_LOCAL_STT_COMMAND?.trim() || sttEnv.hermesCommand?.trim();
	if (hermes) return hermes;
	return undefined;
}

/** Discovers whisper-cpp or whisper-cli on common install paths and PATH. */
export async function discoverWhisperBinary(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
	for (const name of ["whisper-cpp", "whisper-cli"]) {
		const found = await discoverBinary(name, env);
		if (found) return found;
	}
	return undefined;
}

/** Discovers ffmpeg on common install paths and PATH. */
export async function discoverFfmpegBinary(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
	return discoverBinary("ffmpeg", env);
}

/** Transcribes local audio via ffmpeg + whisper.cpp with bounded size and timeout. */
export async function transcribeLocal(input: TranscribeLocalInput): Promise<SttResult> {
	const env = input.env ?? process.env;
	const config = input.config ?? {};
	const runner = input.runner ?? defaultExecRunner;
	const maxBytes = config.maxBytes ?? STT_MAX_BYTES;
	const timeoutMs = config.timeoutMs ?? STT_TIMEOUT_MS;

	let size: number;
	try {
		size = (await stat(input.audioPath)).size;
	} catch {
		return { ok: false, reason: "audio file not found" };
	}
	if (size > maxBytes) {
		return { ok: false, reason: `audio exceeds ${maxBytes} byte limit` };
	}

	const modelPath = config.modelPath?.trim() || env.HEYPI_STT_MODEL_PATH?.trim() || sttEnv.modelPath?.trim();
	if (!modelPath) return { ok: false, reason: "STT model path is not configured" };
	try {
		await access(modelPath);
	} catch {
		return { ok: false, reason: "STT model file is missing" };
	}

	const ffmpeg = config.ffmpeg?.trim() || (await discoverFfmpegBinary(env));
	if (!ffmpeg) return { ok: false, reason: "ffmpeg is not installed" };
	try {
		await access(ffmpeg, constants.X_OK);
	} catch {
		return { ok: false, reason: "ffmpeg is not installed" };
	}

	const customCommand = resolveCustomCommand(config, env);
	let whisperBinary = config.binary?.trim();
	if (!customCommand && !whisperBinary) {
		whisperBinary = await discoverWhisperBinary(env);
		if (!whisperBinary) return { ok: false, reason: "whisper.cpp binary is not installed" };
	}

	const language = config.language?.trim() || "en";
	const tempDir = await mkdtemp(join(tmpdir(), "heypi-stt-"));
	const wavPath = join(tempDir, "input.wav");
	const outputBase = join(tempDir, "transcript");

	try {
		const ffmpegArgs = buildFfmpegArgv(input.audioPath, wavPath);
		const ffmpegResult = await runner(ffmpeg, ffmpegArgs, {
			timeoutMs,
			env: { PATH: env.PATH ?? "" },
		});
		if (ffmpegResult.code !== 0) {
			return { ok: false, reason: "audio conversion failed" };
		}

		const ctx: SttCommandContext = {
			inputPath: wavPath,
			outputDir: tempDir,
			outputPath: outputBase,
			language,
			model: modelPath,
			format: "wav",
		};

		let whisperArgv: string[];
		let whisperExec: string;
		if (customCommand) {
			try {
				whisperArgv = parseCommandTemplate(customCommand, ctx);
			} catch (error) {
				return {
					ok: false,
					reason: error instanceof Error ? error.message : "custom STT command is invalid",
				};
			}
			whisperExec = whisperArgv[0] ?? "";
			if (!whisperExec) return { ok: false, reason: "custom STT command is empty" };
			whisperArgv = whisperArgv.slice(1);
		} else {
			whisperExec = whisperBinary as string;
			whisperArgv = buildDefaultWhisperArgv(whisperExec, ctx).slice(1);
		}

		const whisperResult = await runner(whisperExec, whisperArgv, {
			timeoutMs,
			env: { PATH: env.PATH ?? "" },
		});
		if (whisperResult.code !== 0) {
			return { ok: false, reason: "transcription failed" };
		}

		const text = await readTranscript(outputBase);
		if (!text) return { ok: false, reason: "transcription produced no text" };
		return { ok: true, text };
	} finally {
		await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function readTranscript(outputBase: string): Promise<string | undefined> {
	try {
		const text = (await readFile(`${outputBase}.txt`, "utf8")).trim();
		return text || undefined;
	} catch {
		return undefined;
	}
}

function tokenizeTemplate(template: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	for (let i = 0; i < template.length; i += 1) {
		const ch = template[i];
		if (quote) {
			if (ch === quote) {
				quote = undefined;
				continue;
			}
			current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (current) tokens.push(current);
	return tokens;
}

async function discoverBinary(name: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
	for (const dir of DISCOVERY_DIRS) {
		const path = join(dir, name);
		if (await executable(path)) return path;
	}
	const pathEntries = (env.PATH ?? process.env.PATH ?? "").split(":");
	for (const dir of pathEntries) {
		if (!dir) continue;
		const path = join(dir, name);
		if (await executable(path)) return path;
	}
	return undefined;
}

async function executable(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function defaultExecRunner(
	file: string,
	args: string[],
	options: ExecRunnerOptions,
): Promise<ExecRunnerResult> {
	return await new Promise((resolve) => {
		const maxBuffer = options.maxBuffer ?? 1_000_000;
		let stdout = "";
		let stderr = "";
		let done = false;

		const child = spawn(file, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});

		const finish = (result: ExecRunnerResult) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(result);
		};

		const timer = setTimeout(() => {
			killProcessTree(child);
			finish({ stdout, stderr: `${stderr}\ncommand timed out`, code: 124 });
		}, options.timeoutMs);

		child.stdout?.on("data", (buf: Buffer) => {
			stdout = appendBuffer(stdout, buf.toString("utf8"), maxBuffer);
		});
		child.stderr?.on("data", (buf: Buffer) => {
			stderr = appendBuffer(stderr, buf.toString("utf8"), maxBuffer);
		});
		child.on("error", (error) => {
			finish({ stdout, stderr: `${stderr}${error.message}`, code: 127 });
		});
		child.on("close", (code) => {
			finish({ stdout, stderr, code: code ?? 1 });
		});
	});
}

export function killProcessTree(child: ChildProcess): void {
	if (!child.pid) {
		child.kill("SIGKILL");
		return;
	}
	if (process.platform === "win32") {
		spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" });
		return;
	}
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
}

function appendBuffer(current: string, chunk: string, maxBuffer: number): string {
	const next = current + chunk;
	if (next.length <= maxBuffer) return next;
	return next.slice(next.length - maxBuffer);
}
