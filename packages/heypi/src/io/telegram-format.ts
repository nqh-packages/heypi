import { chunkText } from "../render/chunk.js";

export type TelegramParseMode = "MarkdownV2" | "HTML" | "plain";

const TELEGRAM_MARKUP_LIMIT = 3800;
const TELEGRAM_PLAIN_LIMIT = 4096;

const MARKDOWN_V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;
const HTML_ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "code", "pre", "a"]);

export function escapeMarkdownV2(text: string): string {
	return text.replace(MARKDOWN_V2_SPECIAL, "\\$&");
}

export function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitizeHtml(text: string): string {
	const withoutScripts = text.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
	return withoutScripts.replace(/<\s*(\/?)([a-z0-9]+)([^>]*)>/gi, (match, closing, tag, attrs) => {
		const name = String(tag).toLowerCase();
		if (!HTML_ALLOWED_TAGS.has(name)) return escapeHtml(match);
		if (closing) return `</${name}>`;
		if (name === "a") {
			const href = String(attrs).match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
			const url = href?.[2] ?? href?.[3] ?? href?.[4] ?? "";
			if (!safeUrl(url)) return "";
			return `<a href="${escapeHtml(url)}">`;
		}
		return `<${name}>`;
	});
}

export function formatTelegramText(text: string, mode: TelegramParseMode = "plain"): string {
	if (mode === "plain") return text;
	if (mode === "HTML") return sanitizeHtml(text);
	return escapeMarkdownV2(text);
}

export function telegramParseModeApiValue(mode: TelegramParseMode): string | undefined {
	if (mode === "plain") return undefined;
	return mode;
}

export type TelegramTextChunk = {
	text: string;
	parseMode: TelegramParseMode;
};

export function chunkTelegramText(text: string, mode: TelegramParseMode = "plain"): TelegramTextChunk[] {
	const limit = mode === "plain" ? TELEGRAM_PLAIN_LIMIT : TELEGRAM_MARKUP_LIMIT;
	const parts = chunkText(text, limit);
	return parts.map((part) => ({
		text: formatTelegramText(part, mode),
		parseMode: mode,
	}));
}

export function chunkTelegramFormattedText(text: string, mode: TelegramParseMode = "plain"): TelegramTextChunk[] {
	if (mode === "plain") return chunkTelegramText(text, mode);
	const limit = TELEGRAM_MARKUP_LIMIT;
	const parts = chunkMarkupSafe(text, limit, mode);
	return parts.map((part) => ({
		text: formatTelegramText(part, mode),
		parseMode: mode,
	}));
}

function chunkMarkupSafe(text: string, limit: number, mode: TelegramParseMode): string[] {
	if (mode === "HTML" && text.includes("```")) {
		return chunkCodeAware(text, limit);
	}
	return chunkText(text, limit);
}

function chunkCodeAware(text: string, limit: number): string[] {
	const fence = /```[\s\S]*?```/g;
	let last = 0;
	const segments: string[] = [];
	for (const match of text.matchAll(fence)) {
		const index = match.index ?? 0;
		if (index > last) segments.push(...chunkText(text.slice(last, index), limit));
		segments.push(match[0]);
		last = index + match[0].length;
	}
	if (last < text.length) segments.push(...chunkText(text.slice(last), limit));
	const merged: string[] = [];
	for (const segment of segments) {
		if (!segment) continue;
		if (segment.length <= limit) {
			merged.push(segment);
			continue;
		}
		if (segment.startsWith("```")) merged.push(segment.slice(0, limit));
		else merged.push(...chunkText(segment, limit));
	}
	return merged.length ? merged : chunkText(text, limit);
}

export function plainFallbackChunk(chunk: TelegramTextChunk): TelegramTextChunk {
	return { text: chunk.text.replace(/\\/g, ""), parseMode: "plain" };
}

function safeUrl(input: string): boolean {
	try {
		const url = new URL(input);
		return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "tg:";
	} catch {
		return false;
	}
}
