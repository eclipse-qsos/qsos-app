/********************************************************************************
 * Copyright (c) 2026 Contributors to the Eclipse Foundation
 *
 * See the NOTICE file(s) distributed with this work for additional
 * information regarding copyright ownership.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Apache License, Version 2.0 which is available at
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * SPDX-License-Identifier: Apache-2.0
 ********************************************************************************/

/**
 * Thrown when an identifier coming from a request (software type, software,
 * version, grid, evaluation, user...) cannot safely be used as a file or
 * folder name inside the data directory.
 *
 * `statusCode` is picked up by h3, so the API answers 400 instead of 500.
 */
export class InvalidDataPathError extends Error {
	statusCode = 400;
	statusMessage = "Invalid identifier";

	constructor(segment: unknown) {
		super(`Invalid path segment: ${JSON.stringify(segment)}`);
		this.name = "InvalidDataPathError";
	}
}

// Path separators, Windows-reserved and glob characters, control characters.
const FORBIDDEN_CHARS = /[/\\:*?"<>|[\]{}\u0000-\u001f\u007f]/;

/**
 * Ensure a single path segment cannot escape its parent folder or be
 * interpreted as a glob pattern. Spaces, "@", "+", "." inside the name, etc.
 * stay allowed, as existing identifiers (e-mail addresses, semver versions,
 * free-form names) rely on them.
 */
export function assertSafeSegment(segment: unknown): asserts segment is string {
	if (
		typeof segment !== "string" ||
		segment.length === 0 ||
		segment.length > 255 ||
		segment.startsWith(".") ||
		FORBIDDEN_CHARS.test(segment)
	) {
		throw new InvalidDataPathError(segment);
	}
}
