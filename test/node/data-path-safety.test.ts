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
// @vitest-environment nuxt
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";

import { mockSoftwareType } from "../mock";
import { FileBasedProvider } from "../../app/services/data-providers/file-based-provider";
import { assertSafeSegment, InvalidDataPathError } from "../../app/services/data-providers/safe-path";

const DATA_DIR = "test-data-path-safety";
const provider = new FileBasedProvider("node", DATA_DIR);
const exists = (p: string) => stat(p).then(() => true, () => false);

afterAll(async () => {
	await rm(path.join(process.cwd(), DATA_DIR), { recursive: true, force: true });
});

describe("assertSafeSegment", () => {
	test.each([
		"web_frameworks",
		"Ergonomic Wooden Chair",
		"0.2.2-rc.1",
		"1.0.json",
		"someone+tag@example.com",
		"N0gXNSZuxzkMEDkQR_bIy",
	])("accepts %j", (segment) => {
		expect(() => assertSafeSegment(segment)).not.toThrow();
	});

	test.each([
		"",
		".",
		"..",
		".env",
		":type()",
		"../etc",
		"a/b",
		"a\\b",
		"*",
		"**",
		"a?b",
		"[ab]",
		"{a,b}",
		"nul\u0000byte",
		"x".repeat(256),
		undefined,
		42,
	])("rejects %j", (segment) => {
		expect(() => assertSafeSegment(segment)).toThrow(InvalidDataPathError);
	});

	test("errors carry a 400 status code for h3", () => {
		try {
			assertSafeSegment("..");
		} catch (err: any) {
			expect(err.statusCode).toBe(400);
		}
	});
});

describe("FileBasedProvider path safety", () => {
	test("getDataPath rejects traversal", () => {
		expect(() => provider.getDataPath("software-types", "..", "..", "etc")).toThrow(InvalidDataPathError);
		expect(() => provider.getDataPath("software-types", "../../tmp")).toThrow(InvalidDataPathError);
	});

	test("listing grids of an unknown type creates no folder and answers 404", async () => {
		await expect(provider.getEvaluationGridsByType(":type()")).rejects.toThrow(InvalidDataPathError);

		const unknownType = "does-not-exist";
		await expect(provider.getEvaluationGridsByType(unknownType)).rejects.toMatchObject({ statusCode: 404 });
		expect(await exists(path.join(process.cwd(), DATA_DIR, "software-types", unknownType))).toBe(false);
	});

	test("getSoftwareTypes skips folders without a valid type file", async () => {
		const type = mockSoftwareType();
		await provider.pushSoftwareType(type);
		await mkdir(path.join(process.cwd(), DATA_DIR, "software-types", ":type()", "grids"), { recursive: true });
		await mkdir(path.join(process.cwd(), DATA_DIR, "software-types", "empty-folder"), { recursive: true });

		const types = await provider.getSoftwareTypes();
		expect(types.map((t) => t.uid)).toContain(type.uid);
		expect(types.map((t) => t.uid)).not.toContain(":type()");
		expect(types.map((t) => t.uid)).not.toContain("empty-folder");
	});

	test("getEvaluations rejects glob and traversal patterns", async () => {
		await expect(provider.getEvaluations("**", "x")).rejects.toThrow(InvalidDataPathError);
		await expect(provider.getEvaluations("type", "..")).rejects.toThrow(InvalidDataPathError);
		await expect(provider.getEvaluations("type", "sw", "../..")).rejects.toThrow(InvalidDataPathError);
	});

	test("pushing a software type with an unsafe icon name does not read outside the data folder", async () => {
		const type = { ...mockSoftwareType(), icon: "../../../package.json" };
		await provider.pushSoftwareType(type);
		const read = await provider.getSoftwareType(type.uid);
		expect(read.icon).toBe("");
	});
});
