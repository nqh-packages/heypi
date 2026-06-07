export type RunnerInput = {
	cwd: string;
	promptPath: string;
	skillManifestPath: string;
};

export type RunnerResult = {
	started: boolean;
	command: string;
	evidence?: string;
	error?: string;
};

export interface CodexRunner {
	start(input: RunnerInput): Promise<RunnerResult>;
}

export class FakeCodexRunner implements CodexRunner {
	constructor(
		private readonly result: RunnerResult = {
			started: true,
			command: "hermes-codex --prompt handoff.md",
			evidence: "fake-runner-started",
		},
	) {}

	async start(): Promise<RunnerResult> {
		return this.result;
	}
}

export class CommandCodexRunner implements CodexRunner {
	constructor(private readonly command = "hermes-codex") {}

	async start(input: RunnerInput): Promise<RunnerResult> {
		return {
			started: false,
			command: `${this.command} --cwd ${input.cwd} --prompt ${input.promptPath} --skills ${input.skillManifestPath}`,
			error: "Runtime command adapter is preview-only in this example; configure a trusted runner before live start.",
		};
	}
}
