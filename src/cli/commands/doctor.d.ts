// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/** Type declarations for the `doctor` CLI command module. */

export function doctorCommand(): Promise<void>;
export function registerDoctorCommand(program: import("commander").Command): void;
