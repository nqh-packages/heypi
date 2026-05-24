import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Logger } from "../core/log.js";
import type { HttpRegistrar, HttpRoute } from "./handler.js";

export type HttpListen = {
	host?: string;
	port?: number | string;
};

export type RegisteredHttpRoute = HttpRoute & HttpListen;

export type HttpServerRegistry = HttpRegistrar & {
	listen(): Promise<void>;
	close(): Promise<void>;
};

type Route = Required<Pick<HttpRoute, "method" | "path">> & {
	handler: HttpRoute["handler"];
};

export function createHttpServerRegistry(input: { logger: Logger }): HttpServerRegistry {
	const routes = new Map<string, Route>();
	let listen: { host: string; port: number | string } | undefined;
	let server: Server | undefined;

	return {
		register(route: RegisteredHttpRoute): void {
			const method = normalizeMethod(route.method);
			const path = normalizePath(route.path);
			const key = `${method} ${path}`;
			if (routes.has(key)) throw new Error(`duplicate HTTP route: ${key}`);
			const host = route.host ?? "127.0.0.1";
			const port = route.port ?? 3000;
			if (listen && (listen.host !== host || String(listen.port) !== String(port))) {
				throw new Error(
					`all HTTP adapters in one heypi app must share one host/port; got ${host}:${port}, expected ${listen.host}:${listen.port}`,
				);
			}
			listen ??= { host, port };
			routes.set(key, { method, path, handler: route.handler });
			input.logger.debug("http.route", { method, path, host, port });
		},
		async listen(): Promise<void> {
			if (!listen || server) return;
			const target = listen;
			const port = typeof target.port === "number" ? target.port : Number(target.port);
			if (!Number.isFinite(port)) throw new Error(`HTTP port must be numeric: ${target.port}`);
			server = createServer((req, res) => void dispatch(routes, req, res));
			await new Promise<void>((resolve, reject) => {
				server?.once("error", reject);
				server?.listen(port, target.host, () => {
					server?.off("error", reject);
					input.logger.info("http.start", { host: target.host, port: target.port, routes: routes.size });
					resolve();
				});
			});
		},
		async close(): Promise<void> {
			await new Promise<void>((resolve, reject) => {
				if (!server) return resolve();
				server.close((error) => (error ? reject(error) : resolve()));
			});
			if (server) input.logger.info("http.stop", { routes: routes.size });
			server = undefined;
			routes.clear();
			listen = undefined;
		},
	};
}

async function dispatch(routes: Map<string, Route>, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const method = normalizeMethod(req.method);
	const path = normalizePath(new URL(req.url ?? "/", "http://localhost").pathname);
	const route = routes.get(`${method} ${path}`) ?? routes.get(`* ${path}`);
	const matched =
		route ??
		[...routes.values()].find((candidate) => {
			if (candidate.method !== method && candidate.method !== "*") return false;
			return pathMatches(candidate.path, path);
		});
	if (!matched) {
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: false, error: "not found" }));
		return;
	}
	try {
		await matched.handler(req, res);
	} catch {
		if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: false, error: "http route failed" }));
	}
}

function pathMatches(template: string, path: string): boolean {
	if (template === path) return true;
	const templateParts = template.split("/").filter(Boolean);
	const pathParts = path.split("/").filter(Boolean);
	if (templateParts.length !== pathParts.length) return false;
	for (let i = 0; i < templateParts.length; i++) {
		const part = templateParts[i];
		if (part.startsWith(":")) continue;
		if (part !== pathParts[i]) return false;
	}
	return true;
}

function normalizeMethod(method: string | undefined): string {
	return (method ?? "*").trim().toUpperCase();
}

function normalizePath(path: string): string {
	const trimmed = path.trim();
	if (!trimmed) return "/";
	return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}
