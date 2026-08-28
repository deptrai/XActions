// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/** Type declarations for the `completion` CLI command module. */

export const SUPPORTED_SHELLS: string[];
export function collectCommands(program: import("commander").Command): { name: string; description: string }[];
export function generateCompletion(program: import("commander").Command, shell: string): string;
export function registerCompletionCommand(program: import("commander").Command): void;
