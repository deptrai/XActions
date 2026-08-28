// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/** Type declarations for the `connect` CLI command module. */

export function connectCommand(options?: object): Promise<void>;
export function registerConnectCommand(program: import("commander").Command): void;
