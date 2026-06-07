import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { runHeypi } from "@hunvreus/heypi";
import { createTelegramCofounderApp } from "./app.js";

if (existsSync(".env")) loadEnvFile(".env");

await runHeypi(createTelegramCofounderApp());
