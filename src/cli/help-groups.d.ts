// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/** Type declarations for the grouped root help. */

export interface GroupEntry {
  name: string;
  description: string;
}

export interface CommandGroup {
  title: string;
  hint: string;
  entries: GroupEntry[];
}

export const GROUPS: { title: string; hint: string; commands: string[] }[];

export function groupCommands(program: import("commander").Command): CommandGroup[];

/**
 * @returns Group entry names that no longer match a registered command.
 */
export function findStaleGroupEntries(program: import("commander").Command): string[];

export function renderGroupedCommands(program: import("commander").Command): string;

export function renderRootHelp(program: import("commander").Command, version: string): void;
