#!/usr/bin/env node
// @rust-exception rationale: This is a skill-local macOS glue helper that must run from a checked-out skill without compiling or installing a binary.
import { execFileSync, spawnSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";

const HELIUM_COOKIES_DB = "/Users/huy/Library/Application Support/net.imput.helium/Default/Cookies";
const HELIUM_KEYCHAIN_ACCOUNT = "Helium";
const HELIUM_KEYCHAIN_SERVICE = "Helium Storage Key";
const TWITTER_COOKIE_HOST = ".x.com";
const REQUIRED_COOKIE_NAMES = ["auth_token", "ct0"];
const CHROMIUM_COOKIE_PREFIX_BYTES = 3;
const CHROMIUM_HOST_HASH_BYTES = 32;
const CHROMIUM_KEY_SALT = "saltysalt";
const CHROMIUM_KEY_ITERATIONS = 1003;
const CHROMIUM_KEY_LENGTH = 16;
const CHROMIUM_IV = Buffer.alloc(16, " ");

function readHeliumStorageKey() {
	return execFileSync(
		"security",
		["find-generic-password", "-w", "-a", HELIUM_KEYCHAIN_ACCOUNT, "-s", HELIUM_KEYCHAIN_SERVICE],
		{ encoding: "utf8" },
	).trim();
}

function readEncryptedCookies() {
	const query = `
    select name || '|' || hex(encrypted_value)
    from cookies
    where host_key='${TWITTER_COOKIE_HOST}'
      and name in ('${REQUIRED_COOKIE_NAMES.join("','")}')
    order by name;
  `;

	const output = execFileSync("sqlite3", [HELIUM_COOKIES_DB, query], {
		encoding: "utf8",
	}).trim();

	return output
		.split("\n")
		.filter(Boolean)
		.map((row) => {
			const [name, encryptedHex] = row.split("|");
			return { name, encryptedHex };
		});
}

function decryptChromiumCookie(encryptedHex, storageKey) {
	const encrypted = Buffer.from(encryptedHex, "hex");
	const payload = encrypted.subarray(CHROMIUM_COOKIE_PREFIX_BYTES);
	const key = pbkdf2Sync(storageKey, CHROMIUM_KEY_SALT, CHROMIUM_KEY_ITERATIONS, CHROMIUM_KEY_LENGTH, "sha1");
	const decipher = createDecipheriv("aes-128-cbc", key, CHROMIUM_IV);
	decipher.setAutoPadding(false);
	const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
	const padding = decrypted.at(-1);

	if (!padding || padding < 1 || padding > 16) {
		throw new Error("Helium cookie decryption failed: invalid padding.");
	}

	const unpadded = decrypted.subarray(0, decrypted.length - padding);
	return unpadded.length > CHROMIUM_HOST_HASH_BYTES
		? unpadded.subarray(CHROMIUM_HOST_HASH_BYTES).toString("utf8")
		: unpadded.toString("utf8");
}

function readTwitterCredentials() {
	const storageKey = readHeliumStorageKey();
	const rows = readEncryptedCookies();
	const cookies = new Map(
		rows.map(({ name, encryptedHex }) => [name, decryptChromiumCookie(encryptedHex, storageKey)]),
	);

	for (const name of REQUIRED_COOKIE_NAMES) {
		if (!cookies.get(name)) {
			throw new Error(`Missing ${name} in Helium. Open Helium, log into x.com, then retry.`);
		}
	}

	return {
		authToken: cookies.get("auth_token"),
		ct0: cookies.get("ct0"),
	};
}

function main() {
	const credentials = readTwitterCredentials();
	const result = spawnSync(
		"bird",
		["--auth-token", credentials.authToken, "--ct0", credentials.ct0, ...process.argv.slice(2)],
		{
			stdio: "inherit",
		},
	);

	process.exit(result.status ?? 1);
}

main();
