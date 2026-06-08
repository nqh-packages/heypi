import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildDefaultWhisperArgv,
	buildFfmpegArgv,
	defaultExecRunner,
	type ExecRunner,
	killProcessTree,
	parseCommandTemplate,
	resolveCustomCommand,
	transcribeLocal,
	validateCommandTemplate,
} from "../src/io/stt/local-whisper.js";
import type { SttCommandContext } from "../src/io/stt/types.js";
import { STT_MAX_BYTES, STT_TIMEOUT_MS } from "../src/io/stt/types.js";

const ctx: SttCommandContext = {
	inputPath: "/tmp/job/input.wav",
	outputDir: "/tmp/job",
	outputPath: "/tmp/job/transcript",
	language: "en",
	model: "/models/ggml-base.en.bin",
	format: "wav",
};

test("buildDefaultWhisperArgv uses model path and wav input", () => {
	assert.deepEqual(buildDefaultWhisperArgv("/opt/homebrew/bin/whisper-cpp", ctx), [
		"/opt/homebrew/bin/whisper-cpp",
		"-m",
		"/models/ggml-base.en.bin",
		"-f",
		"/tmp/job/input.wav",
		"-l",
		"en",
		"--output-txt",
		"-of",
		"/tmp/job/transcript",
	]);
});

test("buildFfmpegArgv normalizes to 16 kHz mono wav", () => {
	assert.deepEqual(buildFfmpegArgv("/tmp/voice.ogg", "/tmp/job/input.wav"), [
		"-i",
		"/tmp/voice.ogg",
		"-ar",
		"16000",
		"-ac",
		"1",
		"-y",
		"/tmp/job/input.wav",
	]);
});

test("parseCommandTemplate substitutes only allowed placeholders", () => {
	const template = "whisper-cpp -m {model} -f {input_path} -l {language} --output-txt -of {output_path}";
	assert.deepEqual(parseCommandTemplate(template, ctx), [
		"whisper-cpp",
		"-m",
		"/models/ggml-base.en.bin",
		"-f",
		"/tmp/job/input.wav",
		"-l",
		"en",
		"--output-txt",
		"-of",
		"/tmp/job/transcript",
	]);
});

test("parseCommandTemplate supports quoted tokens and remaining placeholders", () => {
	const template = '"/usr/bin/custom" --dir {output_dir} --format {format} --in {input_path}';
	assert.deepEqual(parseCommandTemplate(template, ctx), [
		"/usr/bin/custom",
		"--dir",
		"/tmp/job",
		"--format",
		"wav",
		"--in",
		"/tmp/job/input.wav",
	]);
});

test("validateCommandTemplate rejects shell metacharacters", () => {
	assert.match(validateCommandTemplate("whisper-cpp; rm -rf /") ?? "", /shell metacharacters/);
	assert.match(validateCommandTemplate("whisper-cpp | cat") ?? "", /shell metacharacters/);
	assert.match(validateCommandTemplate("whisper-cpp $(whoami)") ?? "", /shell metacharacters/);
});

test("validateCommandTemplate rejects unknown placeholders", () => {
	assert.match(validateCommandTemplate("whisper-cpp -f {input_path} -c {chat_id}") ?? "", /unknown placeholder/);
});

test("resolveCustomCommand prefers config then HEYPI then HERMES env", () => {
	assert.equal(resolveCustomCommand({ command: "from-config {input_path}" }, {}), "from-config {input_path}");
	assert.equal(
		resolveCustomCommand({}, { HEYPI_LOCAL_STT_COMMAND: "heypi {input_path}", HERMES_LOCAL_STT_COMMAND: "hermes" }),
		"heypi {input_path}",
	);
	assert.equal(resolveCustomCommand({}, { HERMES_LOCAL_STT_COMMAND: "hermes {input_path}" }), "hermes {input_path}");
});

test("transcribeLocal rejects oversize audio before exec", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-stt-oversize-"));
	const audioPath = join(root, "voice.ogg");
	const calls: string[] = [];
	const runner: ExecRunner = async (file) => {
		calls.push(file);
		return { stdout: "", stderr: "", code: 0 };
	};
	try {
		await writeFile(audioPath, Buffer.alloc(STT_MAX_BYTES + 1));
		const result = await transcribeLocal({
			audioPath,
			config: { modelPath: join(root, "model.bin") },
			env: { PATH: "" },
			runner,
		});
		assert.equal(result.ok, false);
		if (result.ok) throw new Error("expected failure");
		assert.match(result.reason, /exceeds/);
		assert.equal(calls.length, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("transcribeLocal returns structured failure when model is missing", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-stt-model-"));
	const audioPath = join(root, "voice.ogg");
	try {
		await writeFile(audioPath, Buffer.from("tiny"));
		const result = await transcribeLocal({
			audioPath,
			config: { modelPath: join(root, "missing-model.bin") },
			env: { PATH: "" },
		});
		assert.equal(result.ok, false);
		if (result.ok) throw new Error("expected failure");
		assert.match(result.reason, /model file is missing/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("transcribeLocal returns structured failure when ffmpeg is missing", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-stt-ffmpeg-"));
	const audioPath = join(root, "voice.ogg");
	const modelPath = join(root, "model.bin");
	try {
		await writeFile(audioPath, Buffer.from("tiny"));
		await writeFile(modelPath, Buffer.from("model"));
		const result = await transcribeLocal({
			audioPath,
			config: { modelPath, ffmpeg: join(root, "missing-ffmpeg") },
			env: { PATH: "" },
		});
		assert.equal(result.ok, false);
		if (result.ok) throw new Error("expected failure");
		assert.equal(result.reason, "ffmpeg is not installed");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("transcribeLocal runs ffmpeg then whisper with mocked execFile", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-stt-success-"));
	const audioPath = join(root, "voice.ogg");
	const modelPath = join(root, "model.bin");
	const ffmpegPath = join(root, "ffmpeg");
	const whisperPath = join(root, "whisper-cpp");
	const calls: Array<{ file: string; args: string[] }> = [];

	const runner: ExecRunner = async (file, args) => {
		calls.push({ file, args });
		if (file.endsWith("ffmpeg")) return { stdout: "", stderr: "", code: 0 };
		if (file.endsWith("whisper-cpp")) {
			const ofIndex = args.indexOf("-of");
			const outputBase = ofIndex >= 0 ? args[ofIndex + 1] : join(root, "transcript");
			if (outputBase) await writeFile(`${outputBase}.txt`, "hello from whisper\n", "utf8");
			return { stdout: "", stderr: "", code: 0 };
		}
		return { stdout: "", stderr: "unexpected command", code: 1 };
	};

	try {
		await writeFile(audioPath, Buffer.from("fake-ogg"));
		await writeFile(modelPath, Buffer.from("model"));
		await writeFile(ffmpegPath, "#!/bin/sh\nexit 0\n", "utf8");
		await writeFile(whisperPath, "#!/bin/sh\nexit 0\n", "utf8");
		await chmod(ffmpegPath, 0o755);
		await chmod(whisperPath, 0o755);

		const result = await transcribeLocal({
			audioPath,
			config: { modelPath, binary: whisperPath, ffmpeg: ffmpegPath },
			env: { PATH: "" },
			runner,
		});

		if (!result.ok) assert.fail(result.reason);
		assert.equal(result.text, "hello from whisper");
		assert.equal(calls.length, 2);
		assert.equal(calls[0]?.file, ffmpegPath);
		assert.match(calls[0]?.args.join(" ") ?? "", /16000/);
		assert.equal(calls[1]?.file, whisperPath);
		assert.deepEqual(calls[1]?.args.slice(0, 2), ["-m", modelPath]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("transcribeLocal uses custom command template via env", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-stt-custom-"));
	const audioPath = join(root, "voice.ogg");
	const modelPath = join(root, "model.bin");
	const customBin = join(root, "custom-stt");
	const calls: Array<{ file: string; args: string[] }> = [];

	const runner: ExecRunner = async (file, args) => {
		calls.push({ file, args });
		if (file.endsWith("ffmpeg")) return { stdout: "", stderr: "", code: 0 };
		if (file.endsWith("custom-stt")) {
			const outputPath = args[args.indexOf("--out") + 1];
			if (outputPath) await writeFile(`${outputPath}.txt`, "custom transcript", "utf8");
			return { stdout: "", stderr: "", code: 0 };
		}
		return { stdout: "", stderr: "unexpected", code: 1 };
	};

	try {
		await writeFile(audioPath, Buffer.from("fake-ogg"));
		await writeFile(modelPath, Buffer.from("model"));
		await writeFile(customBin, "#!/bin/sh\nexit 0\n", "utf8");
		await writeFile(join(root, "ffmpeg"), "#!/bin/sh\nexit 0\n", "utf8");
		await chmod(customBin, 0o755);
		await chmod(join(root, "ffmpeg"), 0o755);

		const result = await transcribeLocal({
			audioPath,
			config: { modelPath, ffmpeg: join(root, "ffmpeg") },
			env: {
				PATH: "",
				HEYPI_LOCAL_STT_COMMAND: `${customBin} --model {model} --in {input_path} --out {output_path}`,
			},
			runner,
		});

		if (!result.ok) assert.fail(result.reason);
		assert.equal(result.text, "custom transcript");
		assert.equal(calls[1]?.file, customBin);
		assert.ok(calls[1]?.args.includes(modelPath));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("defaultExecRunner times out and kills the process tree", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-stt-timeout-"));
	const slow = join(root, "slow");
	await writeFile(
		slow,
		`#!/bin/sh
sleep 30
`,
		"utf8",
	);
	await chmod(slow, 0o755);

	const started = Date.now();
	const result = await defaultExecRunner(slow, [], {
		timeoutMs: 100,
		env: { PATH: root },
	});
	const elapsed = Date.now() - started;

	assert.equal(result.code, 124);
	assert.match(result.stderr, /timed out/);
	assert.ok(elapsed < 5_000);
	await rm(root, { recursive: true, force: true });
});

test("killProcessTree falls back to child kill when group kill fails", () => {
	const killed: string[] = [];
	const child = {
		pid: 42,
		kill(signal: string) {
			killed.push(signal);
		},
	} as Parameters<typeof killProcessTree>[0];

	const originalKill = process.kill.bind(process);
	process.kill = ((pid: number, signal: NodeJS.Signals) => {
		if (pid === -42 && signal === "SIGKILL") throw new Error("no group");
		return originalKill(pid, signal);
	}) as typeof process.kill;

	try {
		killProcessTree(child);
		assert.deepEqual(killed, ["SIGKILL"]);
	} finally {
		process.kill = originalKill;
	}
});

test("STT safety defaults match plan limits", () => {
	assert.equal(STT_MAX_BYTES, 25_000_000);
	assert.equal(STT_TIMEOUT_MS, 300_000);
});
