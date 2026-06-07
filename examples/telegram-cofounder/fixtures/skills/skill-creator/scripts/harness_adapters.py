#!/usr/bin/env python3
"""Harness adapters for skill-creator automation.

Core skill-creator workflow stays harness-agnostic.
Adapters own harness-specific mechanics such as:
- how skills are surfaced to the agent
- how trigger evaluation is executed
- how text generation is delegated for description improvement
"""

from __future__ import annotations

import json
import os
import select
import shutil
import subprocess
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path


class AdapterError(RuntimeError):
    """Raised when the selected adapter cannot perform a requested action."""


@dataclass(frozen=True)
class AdapterCapabilities:
    trigger_eval: bool
    text_generation: bool


class HarnessAdapter:
    name = "base"
    capabilities = AdapterCapabilities(trigger_eval=False, text_generation=False)

    def find_project_root(self, start: Path | None = None) -> Path:
        return start or Path.cwd()

    def discovery_description(self) -> str:
        return "the harness exposes a skill name and description to the agent before invocation"

    def run_single_query(
        self,
        query: str,
        skill_name: str,
        skill_description: str,
        timeout: int,
        project_root: str,
        model: str | None = None,
    ) -> bool:
        raise AdapterError(f"Adapter '{self.name}' does not support automated trigger evaluation.")

    def generate_text(self, prompt: str, model: str | None = None, timeout: int = 300) -> str:
        raise AdapterError(f"Adapter '{self.name}' does not support automated text generation.")

    def capability_dict(self) -> dict:
        return asdict(self.capabilities)


class ClaudeCodeAdapter(HarnessAdapter):
    name = "claude-code"
    capabilities = AdapterCapabilities(trigger_eval=True, text_generation=True)

    def find_project_root(self, start: Path | None = None) -> Path:
        current = start or Path.cwd()
        for parent in [current, *current.parents]:
            if (parent / ".claude").is_dir():
                return parent
        return current

    def discovery_description(self) -> str:
        return (
            "the harness exposes skills in the available skills list, and the agent decides "
            "whether to consult one from the skill metadata before reading the full file"
        )

    def _base_env(self) -> dict[str, str]:
        env = dict(os.environ)
        env.pop("CLAUDECODE", None)
        return env

    def run_single_query(
        self,
        query: str,
        skill_name: str,
        skill_description: str,
        timeout: int,
        project_root: str,
        model: str | None = None,
    ) -> bool:
        unique_id = uuid.uuid4().hex[:8]
        clean_name = f"{skill_name}-skill-{unique_id}"
        project_commands_dir = Path(project_root) / ".claude" / "commands"
        command_file = project_commands_dir / f"{clean_name}.md"

        try:
            project_commands_dir.mkdir(parents=True, exist_ok=True)
            indented_desc = "\n  ".join(skill_description.split("\n"))
            command_content = (
                f"---\n"
                f"description: |\n"
                f"  {indented_desc}\n"
                f"---\n\n"
                f"# {skill_name}\n\n"
                f"This skill handles: {skill_description}\n"
            )
            command_file.write_text(command_content)

            cmd = [
                "claude",
                "-p",
                query,
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
            ]
            if model:
                cmd.extend(["--model", model])

            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                cwd=project_root,
                env=self._base_env(),
            )

            triggered = False
            start_time = time.time()
            buffer = ""
            pending_tool_name = None
            accumulated_json = ""

            try:
                while time.time() - start_time < timeout:
                    if process.poll() is not None:
                        remaining = process.stdout.read()
                        if remaining:
                            buffer += remaining.decode("utf-8", errors="replace")
                        break

                    ready, _, _ = select.select([process.stdout], [], [], 1.0)
                    if not ready:
                        continue

                    chunk = os.read(process.stdout.fileno(), 8192)
                    if not chunk:
                        break
                    buffer += chunk.decode("utf-8", errors="replace")

                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue

                        try:
                            event = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        if event.get("type") == "stream_event":
                            stream_event = event.get("event", {})
                            stream_type = stream_event.get("type", "")

                            if stream_type == "content_block_start":
                                content_block = stream_event.get("content_block", {})
                                if content_block.get("type") == "tool_use":
                                    tool_name = content_block.get("name", "")
                                    if tool_name in ("Skill", "Read"):
                                        pending_tool_name = tool_name
                                        accumulated_json = ""
                                    else:
                                        return False

                            elif stream_type == "content_block_delta" and pending_tool_name:
                                delta = stream_event.get("delta", {})
                                if delta.get("type") == "input_json_delta":
                                    accumulated_json += delta.get("partial_json", "")
                                    if clean_name in accumulated_json:
                                        return True

                            elif stream_type in ("content_block_stop", "message_stop"):
                                if pending_tool_name:
                                    return clean_name in accumulated_json
                                if stream_type == "message_stop":
                                    return False

                        elif event.get("type") == "assistant":
                            message = event.get("message", {})
                            for content_item in message.get("content", []):
                                if content_item.get("type") != "tool_use":
                                    continue
                                tool_name = content_item.get("name", "")
                                tool_input = content_item.get("input", {})
                                if tool_name == "Skill" and clean_name in tool_input.get("skill", ""):
                                    triggered = True
                                elif tool_name == "Read" and clean_name in tool_input.get("file_path", ""):
                                    triggered = True
                                return triggered

                        elif event.get("type") == "result":
                            return triggered
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()

            return triggered
        finally:
            if command_file.exists():
                command_file.unlink()

    def generate_text(self, prompt: str, model: str | None = None, timeout: int = 300) -> str:
        cmd = ["claude", "-p", "--output-format", "text"]
        if model:
            cmd.extend(["--model", model])

        result = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            env=self._base_env(),
            timeout=timeout,
        )
        if result.returncode != 0:
            raise AdapterError(
                f"Adapter '{self.name}' text generation failed with exit code {result.returncode}: {result.stderr.strip()}"
            )
        return result.stdout


class ManualAdapter(HarnessAdapter):
    name = "manual"
    capabilities = AdapterCapabilities(trigger_eval=False, text_generation=False)

    def discovery_description(self) -> str:
        return (
            "the harness may expose skill metadata differently or may require manual invocation; "
            "automated trigger evaluation is not available through this adapter"
        )

    def run_single_query(
        self,
        query: str,
        skill_name: str,
        skill_description: str,
        timeout: int,
        project_root: str,
        model: str | None = None,
    ) -> bool:
        raise AdapterError(
            "The 'manual' adapter does not support automated trigger evaluation. "
            "Use qualitative review, implement a harness adapter, or select an adapter that supports trigger evaluation."
        )

    def generate_text(self, prompt: str, model: str | None = None, timeout: int = 300) -> str:
        raise AdapterError(
            "The 'manual' adapter does not support automated description improvement. "
            "Use a harness adapter with text generation support or revise the description manually."
        )


ADAPTERS = {
    "claude": ClaudeCodeAdapter,
    "claude-code": ClaudeCodeAdapter,
    "manual": ManualAdapter,
}


def detect_default_adapter_name() -> str:
    if shutil.which("claude"):
        return "claude-code"
    return "manual"


def resolve_adapter(name: str) -> HarnessAdapter:
    adapter_name = detect_default_adapter_name() if name == "auto" else name
    factory = ADAPTERS.get(adapter_name)
    if not factory:
        supported = ", ".join(sorted({*ADAPTERS.keys(), "auto"}))
        raise AdapterError(f"Unknown adapter '{name}'. Supported adapters: {supported}")
    return factory()


def supported_adapter_names() -> list[str]:
    return ["auto", "claude-code", "manual"]
