import { Queue } from "../../runtime/queue.js";

export type BoundedQueueOptions = {
	maxConcurrent?: number;
	maxPerChat?: number;
	maxPending?: number;
};

export type BoundedQueueSubmitResult<T> =
	| { ok: false; reason: "full" }
	| { ok: true; job: Promise<{ result: T; waitMs: number }> };

/** Wraps Queue with a cap on queued (not yet running) jobs. */
export class BoundedQueue {
	private readonly inner: Queue;

	constructor(private readonly options: BoundedQueueOptions = {}) {
		this.inner = new Queue({
			maxConcurrent: options.maxConcurrent,
			maxPerChat: options.maxPerChat,
		});
	}

	trySubmit<T>(chat: string, execute: () => Promise<T>, signal?: AbortSignal): BoundedQueueSubmitResult<T> {
		const maxPending = this.options.maxPending ?? 32;
		if (this.inner.pendingDepth() >= maxPending) return { ok: false, reason: "full" };
		return {
			ok: true,
			job: this.inner.submit(chat, execute, signal).then(({ result, waitMs }) => ({ result, waitMs })),
		};
	}
}
