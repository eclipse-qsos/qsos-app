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

/*
File-based data provider for software and evaluation data

File structure:
data/{softwareType}/{softwareType}.json - Information about the type of software
data/{softwareType}/softwares/{softwareUid}/{softwareUid}.json - Information about the software
data/{softwareType}/softwares/{softwareUid}/{version}/{version}.json - Information about a specific software version
data/{softwareType}/grids/{gridVersion}.json - Evaluation grid for a certain type of software
data/{softwareType}/softwares/{softwareUid}/{version}/evaluations/{gridVersion}/{evaluationUid}.json - Evaluation
*/

import path from "node:path";

import type { Evaluation, EvaluationFileData, EvaluationGrid, EvaluationGridFileData, EvaluationListItem } from "../../../types/evaluation";
import type { Software, SoftwareFileData, SoftwareVersion } from "../../../types/software";
import type { SoftwareType } from "../../../types/software";
import type { DataProvider } from "./data-provider";
import type { RequirementPreset } from "../../../types/requirements";
import type { User } from "../../../types/user";
import { processIconBase64 } from "../image-processer";
import { BunFSProvider } from "./bun-fs-provider";
import type { Dirent } from "node:fs";
import { NodeFSProvider } from "./node-fs-provider";
import log from "loglevel";
import { rimraf } from 'rimraf';
import { QSOS_VERSIONS } from "../qsos-versions/qsos-versions";
import { compareSemver } from "../../../utils/semver";
import { assertSafeSegment, InvalidDataPathError } from "./safe-path";

const toJSON = (data: object) => JSON.stringify(data, null, "\t");

log.setLevel("info");

export class FileBasedProvider implements DataProvider {
    fs: FileSystemProvider;
    dataPath: string;

    constructor(platform: "bun" | "node", dataPath = "data") {
        this.fs = platform === "bun" ? BunFSProvider : NodeFSProvider;
        this.dataPath = path.join(process.cwd(), dataPath);
        if (!this.fs.folderExists(this.dataPath)) {
            this.fs.makeFolder(this.dataPath).catch((err) => {
                console.error(`Couldn't create data folder at ${this.dataPath}`, err)
            })
        }
    }

    /**
     * Build a path inside the data folder. Every segment usually comes from a
     * request (route params, body, stored file names), so each one is
     * validated to prevent path traversal and stray folders such as ":type()".
     */
    getDataPath(...args: string[]) {
        args.forEach(assertSafeSegment)
        const fullPath = path.join(this.dataPath, ...args)
        if (fullPath !== this.dataPath && !fullPath.startsWith(this.dataPath + path.sep)) {
            throw new InvalidDataPathError(args.join("/"))
        }
        return fullPath
    }

    private isMaturityGrid(sections?: any[]): boolean {
        return !sections?.some(s =>
            s.ref === "maturity" ||
            s.ref === "qsos_maturity_2_0.maturity" ||
            s.name === "Maturity" ||
            s.name === "maturité" ||
            s.name === "Maturité" ||
            s.name === "generic" ||
            s.name === "Section générique"
        );
    }

    /* ========================
        Software types
       ======================== */

    async getSoftwareTypeFile(type: string) {
        try {
            return await this.fs.readJSON<SoftwareType>(this.getDataPath("software-types", type, `${type}.json`))
        } catch (err: any) {
            // Unknown software type: answer 404 instead of 500 (h3 reads statusCode)
            if (err?.code === "ENOENT") err.statusCode = 404
            throw err
        }
    }

    async getSoftwareTypes(): Promise<SoftwareType[]> {
        const dirContent = await this.fs.readFolder(this.getDataPath("software-types"))
        const paths = dirContent.filter((dir) => dir.isDirectory());
        // One broken or foreign folder must not take the whole list down
        const results = await Promise.allSettled(
            paths.map(async (dir) => this.getSoftwareType(dir.name))
        )
        return results.flatMap((result, i) => {
            if (result.status === "fulfilled") return [result.value]
            console.warn(`Skipping invalid software type folder "${paths[i]?.name}":`, result.reason?.message ?? result.reason)
            return []
        })
    }

    async getSoftwareType(type: string): Promise<SoftwareType> {
        const data = await this.getSoftwareTypeFile(type)
        if (data.icon) {
            try {
                const iconBase64 = await this.fs.readBase64(this.getDataPath("software-types", type, data.icon));
                data.icon = `data:image/png;base64,${iconBase64}`
            } catch (err) {
                console.error(`Couldn't read icon file ${data.icon} for software type ${type}`, err)
                data.icon = ""
            }
        }
        return data
    }

    async pushSoftwareType(type: SoftwareType, previousTypeRef?: string): Promise<SoftwareType> {
        const typeRef = type.uid;
        if (previousTypeRef && previousTypeRef !== typeRef) {
            log.info(`Software type name has changed, renaming folder from ${previousTypeRef} to ${typeRef}`)
            await this.fs.deleteFile(this.getDataPath("software-types", previousTypeRef, `${previousTypeRef}.json`))
            await this.fs.moveFolder(this.getDataPath("software-types", previousTypeRef), this.getDataPath("software-types", typeRef))
        }

        if (type.icon?.startsWith('data:image')) {
            const extension = type.icon.split(';')[0]?.split('/')[1]
            const imgData = type.icon.split(',')[1]
            if (extension && imgData) {
                try {
                    const processedImg = await processIconBase64(imgData, 48, 48)
                    const fileName = `icon.${extension}`
                    const iconPath = this.getDataPath("software-types", type.uid, fileName)
                    await this.fs.writeFile(iconPath, processedImg)
                    type.icon = fileName
                } catch (err) {
                    console.error(`Couldn't write icon file for software type ${type.name}`, err)
                    type.icon = ""
                }
            }
        }
        const creatorEmail = (type.creatorEmail || (type as any)?.author?.email || "").trim()
        if (!creatorEmail) {
            throw new Error("creatorEmail is required to save a software type.")
        }
        const softwareTypeFileData: SoftwareType = {
            uid: type.uid,
            name: type.name,
            description: type.description,
            icon: type.icon,
            creatorEmail,
            createdAt: type.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }

        await this.fs.writeFile(
            this.getDataPath("software-types", typeRef, `${typeRef}.json`),
            toJSON(softwareTypeFileData)
        )
        return softwareTypeFileData
    }


    /* ========================
        Software
      ======================== */

    getSoftwareFilePath(type: string, uid: string) {
        return this.getDataPath("software-types", type, "softwares", uid, `${uid}.json`)
    }

    getSoftwareFile(type: string, uid: string) {
        return this.fs.readJSON<SoftwareFileData>(this.getSoftwareFilePath(type, uid))
    }

    async getSoftwaresByType(type: string): Promise<Software[]> {
        const dirContent = await this.fs.readFolder(this.getDataPath("software-types", type, "softwares"))
            .catch((err) => {
                if (err.code === 'ENOENT') return []
                throw err
            })

        const paths = dirContent.filter((dir) => dir.isDirectory());
        return Promise.all([
            this.getSoftwareTypeFile(type) as Promise<SoftwareType>,
            ...paths
                .filter(async (software) => this.fs.fileExists(this.getSoftwareFilePath(type, software.name)))
                .map(async (software) => this.getSoftwareFile(type, software.name))
        ]).then(([type, ...softwares]) => Promise.all(softwares.map(async (data: SoftwareFileData) => {
            if (data.icon) {
                try {
                    const iconBase64 = await this.fs.readBase64(this.getDataPath("software-types", type.uid, "softwares", data.uid, data.icon));
                    const extension = data.icon.split('.').pop()
                    data.icon = `data:image/${extension};base64,${iconBase64}`
                } catch (err) {
                    console.error(`Couldn't read icon file ${data.icon} for software type ${type}`, err)
                    data.icon = ""
                }
            }
            return { ...data, type } as Software
        })))
    }

    async getSoftware(
        type: string,
        uid: string,
    ): Promise<Software> {
        return Promise.all([
            this.getSoftwareFile(type, uid),
            this.getSoftwareTypeFile(type),
            this.getSoftwareVersions(type, uid)
        ]).then(async ([data, type, versions]) => {
            if (data.icon) {
                try {
                    const iconBase64 = await this.fs.readBase64(this.getDataPath("software-types", type.uid, "softwares", data.uid, data.icon));
                    const extension = data.icon.split('.').pop()
                    data.icon = `data:image/${extension};base64,${iconBase64}`
                } catch (err) {
                    console.error(`Couldn't read icon file ${data.icon} for software type ${type}`, err)
                    data.icon = ""
                }
            }
            return { ...data, type, versions } as Software
        })
    }

    async pushSoftware(software: Software, previousType?: string, previousUid?: string): Promise<Software> {
        const newType = software.type.uid;
        if (previousType && previousType !== newType) {
            log.info(`Software type has changed, moving folder from ${previousType} to ${newType}`);
            await this.fs.moveFolder(
                this.getDataPath("software-types", previousType, "softwares", previousUid ?? software.uid),
                this.getDataPath("software-types", newType, "softwares", software.uid)
            )
        }
        else if (previousUid && previousUid !== software.uid) {
            log.info(`Software name has changed, renaming folder ${previousUid} into ${software.uid}`)
            await this.fs.deleteFile(this.getDataPath("software-types", newType, "softwares", previousUid, `${previousUid}.json`))
            await this.fs.moveFolder(
                this.getDataPath("software-types", newType, "softwares", previousUid),
                this.getDataPath("software-types", newType, "softwares", software.uid)
            )
        }

        const creatorEmail = (software.creatorEmail || (software as any)?.author?.email || "").trim()
        if (!creatorEmail) {
            throw new Error("creatorEmail is required to save a software.")
        }

        const softwareFileData: SoftwareFileData = {
            uid: software.uid,
            name: software.name,
            description: software.description,
            licenseId: software.licenseId,
            url: software.url,
            demoUrl: software.demoUrl,
            creatorEmail,
            createdAt: software.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString()

        }

        if (software.icon?.startsWith('data:image')) {
            const extension = software.icon.split(';')[0]?.split('/')[1]
            const imgData = software.icon.split(',')[1]
            if (extension && imgData) {
                try {
                    const processedImg = await processIconBase64(imgData, 48, 48)
                    const fileName = `icon.${extension}`
                    const iconPath = this.getDataPath("software-types", newType, "softwares", software.uid, fileName)
                    await this.fs.writeFile(iconPath, processedImg)
                    software.icon = fileName
                    softwareFileData.icon = fileName
                } catch (err) {
                    console.error(`Couldn't write icon file for software ${software.name}`, err)
                    software.icon = ""
                }
            }
        }

        await this.fs.writeFile(
            this.getSoftwareFilePath(newType, software.uid),
            toJSON(softwareFileData),
        );

        if (software.versions) {
            await Promise.all(software.versions.map(version => this.pushSoftwareVersion(newType, software.uid, version)))
        }

        return software;
    }

    async deleteSoftware(type: string, uid: string): Promise<void> {
        const folderPath = this.getDataPath("software-types", type, "softwares", uid);
        await rimraf(folderPath);
    }



    /* ========================
        Software versions
    ======================== */

    getSoftwareVersionFilePath(type: string, softwareUid: string, version: string, folder: boolean = false) {
        const dir = this.getDataPath("software-types", type, "softwares", softwareUid, version)
        return folder ? dir : path.join(dir, `${version}.json`)
    }

    async getSoftwareVersionFile(type: string, softwareUid: string, version: string): Promise<SoftwareVersion | null> {
        try {
            return this.fs.readJSON<SoftwareVersion>(this.getSoftwareVersionFilePath(type, softwareUid, version));
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                return null;
            }
            throw err;
        }
    }

    async getSoftwareVersions(
        type: string,
        uid: string,
    ): Promise<SoftwareVersion[]> {
        const dirContent = await this.fs.readFolder(this.getDataPath("software-types", type, "softwares", uid));
        const paths = dirContent.filter((dir) => dir.isDirectory());
        return Promise.all(
            paths.map((version) => this.getSoftwareVersionFile(type, uid, version.name))
        ).then((versions) => versions
            .filter((version): version is SoftwareVersion => version !== null)
            .sort((a, b) => compareSemver(b.version, a.version)) // Sort in descending semver order
        )
    }

    async existsSoftwareVersion(
        type: string,
        softwareUid: string,
        version: string,
    ): Promise<boolean> {
        //log.debug("existsSoftwareVersion path", this.getSoftwareVersionFilePath(type, softwareUid, version))
        return this.fs.fileExists(this.getSoftwareVersionFilePath(type, softwareUid, version))
    }

    async getSoftwareVersion(
        type: string,
        softwareUid: string,
        version: string,
    ): Promise<SoftwareVersion | null> {
        return this.getSoftwareVersionFile(type, softwareUid, version);
    }

    async pushSoftwareVersion(type: string, softwareUid: string, softwareVersion: SoftwareVersion): Promise<SoftwareVersion> {
        //log.debug("pushSoftwareVersion path", this.getSoftwareVersionFilePath(type, softwareUid, softwareVersion.version))
        const creatorEmail = (softwareVersion.creatorEmail || (softwareVersion as any)?.author?.email || "").trim()
        if (!creatorEmail) {
            throw new Error("creatorEmail is required to save a software version.")
        }

        // Create a copy to avoid mutating the input
        const versionToSave: SoftwareVersion = {
            ...softwareVersion,
            creatorEmail,
            createdAt: softwareVersion.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await this.fs.writeFile(this.getSoftwareVersionFilePath(
            type,
            softwareUid,
            softwareVersion.version
        ), toJSON(versionToSave))
        return softwareVersion
    }

    async deleteSoftwareVersion(
        type: string,
        softwareUid: string,
        version: string,
    ): Promise<void> {
        const folderPath = this.getDataPath("software-types", type, "softwares", softwareUid, version);
        await rimraf(folderPath);
    }

    /* ========================
        Evaluation grids
    ======================== */

    getEvaluationGridFilePath(type: string, gridVersion: string) {
        return this.getDataPath("software-types", type, "grids", `${gridVersion}.json`)
    }

    getEvaluationGridFile(type: string, gridVersion: string) {
        return this.fs.readJSON<EvaluationGrid>(this.getEvaluationGridFilePath(type, gridVersion))
    }

    async getEvaluationGridsByType(
        type: string,
    ): Promise<EvaluationGrid[]> {
        const gridsPath = this.getDataPath("software-types", type, "grids")
        // Read-only: a missing grids folder simply means no grids (readFolder returns []).
        // Never create folders here, as this is reachable by anonymous GET requests.
        const dirContent = await this.fs.readFolder(gridsPath);
        const paths = dirContent.filter((file) => file && file.isFile() && file.name.endsWith(".json"));
        return Promise.all([
            this.getSoftwareTypeFile(type),
            ...paths.map((file) => this.getEvaluationGridFile(type, file.name.replace(".json", "")))
        ])
            .then(([softwareType, ...grids]) => grids.map(data => ({ ...data, softwareType } as EvaluationGrid)))
            .then(grids => grids.sort((a, b) => new Date(a.createdAt).getTime() > new Date(b.createdAt).getTime() ? -1 : 1))
            .then(grids => grids.map(grid => {
                if (this.isMaturityGrid(grid.sections)) {
                    const qsosVersion = QSOS_VERSIONS[grid.qsosVersion]
                    if (qsosVersion?.maturitySection) {
                        grid.sections.unshift(qsosVersion.maturitySection)
                    }
                }
                return grid
            }))
    }

    async getEvaluationGrid(
        type: string,
        gridVersion: string,
    ): Promise<EvaluationGrid> {
        return Promise.all([
            this.getEvaluationGridFile(type, gridVersion),
            this.getSoftwareTypeFile(type)
        ]).then(([data, softwareType]) => {
            // Inject maturity section if not already present
            if (this.isMaturityGrid(data.sections)) {
                const qsosVersion = QSOS_VERSIONS[data.qsosVersion]
                if (qsosVersion?.maturitySection) {
                    data.sections.unshift(qsosVersion.maturitySection)
                }
            }
            return { ...data, softwareType } as EvaluationGrid
        })
    }

    async pushEvaluationGrid(
        grid: EvaluationGrid,
    ): Promise<EvaluationGrid> {
        const now = new Date().toISOString();
        const gridFileData: EvaluationGridFileData = {
            gridVersion: grid.gridVersion,
            qsosVersion: grid.qsosVersion,
            createdAt: grid.createdAt && grid.createdAt.trim() ? grid.createdAt : now,
            creatorEmail: grid.creatorEmail,
            updatedAt: grid.updatedAt && grid.updatedAt.trim() ? grid.updatedAt : now,
            changeLog: grid.changeLog,
            sections: grid.sections.filter(section => section.ref !== "maturity"), // Maturity section is loaded from QSOS version
        }
        await this.fs.writeFile(
            this.getEvaluationGridFilePath(grid.softwareType.uid, grid.gridVersion),
            toJSON(gridFileData),
        );
        return grid
    }

    async deleteEvaluationGrid(
        type: string,
        gridVersion: string,
    ): Promise<void> {
        return await this.fs.deleteFile(this.getEvaluationGridFilePath(type, gridVersion));
    }


    /* ========================
        Evaluations
    ======================== */

    getEvaluationFilePath(type: string, softwareUid: string, version: string, gridVersion: string, evaluationUid: string) {
        return this.getDataPath("software-types", type, "softwares", softwareUid, version, "evaluations", gridVersion, `${evaluationUid}.json`)
    }

    getEvaluationFile(type: string, softwareUid: string, version: string, gridVersion: string, evaluationUid: string) {
        return this.fs.readJSON<Evaluation>(this.getEvaluationFilePath(type, softwareUid, version, gridVersion, evaluationUid))
    }

    async getEvaluations(type: string, softwareUid: string, softwareVersion = "*", gridVersion = "*"): Promise<EvaluationListItem[]> {
        // These segments end up in a glob pattern: only the "*" wildcard defaults are allowed
        assertSafeSegment(type)
        assertSafeSegment(softwareUid)
        if (softwareVersion !== "*") assertSafeSegment(softwareVersion)
        if (gridVersion !== "*") assertSafeSegment(gridVersion)
        const evaluationsPath = path.join("software-types", type, "softwares", softwareUid, softwareVersion, "evaluations", gridVersion, "*.json")
        const paths = await this.fs.glob(evaluationsPath, this.dataPath)
        //log.debug("Searching for evaluations", evaluationsPath, "Found evaluations", paths)
        return Promise.all(paths.map(filePath => this.fs.readJSON<Evaluation>(path.join(this.dataPath, filePath))))
            .then(evaluations => evaluations.map((data, i) => {
                const softwareVersion = paths[i]?.split(path.sep)[4]
                const gridVersion = paths[i]?.split(path.sep)[6]
                if (!gridVersion || !softwareVersion) {
                    console.error(`Couldn't parse evaluation file path ${paths[i]}`)
                    return { ...data, gridVersion: "unknown", softwareVersion: "unknown" }
                }
                return {
                    ...data,
                    gridVersion,
                    softwareVersion
                }
            }))
    }

    async getEvaluation(
        type: string,
        softwareUid: string,
        version: string,
        gridVersion: string,
        evaluationUid: string,
    ): Promise<Evaluation> {
        return Promise.all([
            this.getSoftwareTypeFile(type),
            this.getSoftware(type, softwareUid),
            this.getSoftwareVersion(type, softwareUid, version),
            this.getEvaluationGridFile(type, gridVersion),
            this.getEvaluationFile(type, softwareUid, version, gridVersion, evaluationUid)
        ]).then(([softwareType, software, version, grid, evaluation]) => {
            if (this.isMaturityGrid(grid.sections)) {
                const qsosVersion = QSOS_VERSIONS[grid.qsosVersion]
                if (qsosVersion?.maturitySection) {
                    grid.sections.unshift(qsosVersion.maturitySection)
                }
                // If QSOS version not found or has no maturitySection, just continue without adding it
            }
            return {
                ...evaluation,
                grid: { ...grid, softwareType },
                software: { ...software, type: softwareType },
                softwareVersion: version
            } as Evaluation
        })
    }

    async pushEvaluation(evaluation: Evaluation): Promise<Evaluation> {
        const evaluationFileData: EvaluationFileData = {
            evaluationUid: evaluation.evaluationUid,
            authors: evaluation.authors,
            language: evaluation.language,
            sections: evaluation.sections,
            createdAt: evaluation.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
        await this.fs.writeFile(
            this.getEvaluationFilePath(
                evaluation.software.type.uid,
                evaluation.software.uid,
                evaluation.softwareVersion.version,
                evaluation.grid.gridVersion,
                evaluation.evaluationUid,
            ),
            toJSON(evaluationFileData),
        );
        return evaluation
    }

    async deleteEvaluation(
        type: string,
        softwareUid: string,
        version: string,
        gridVersion: string,
        evaluationUid: string,
    ): Promise<void> {
        return await this.fs.deleteFile(this.getEvaluationFilePath(
            type,
            softwareUid,
            version,
            gridVersion,
            evaluationUid,
        ));
    }

    /* ========================
        Requirement presets
       ======================== */

    getRequirementPresetPath(userUid: string, presetUid: string) {
        return this.getDataPath("users", userUid, "requirements-presets", `${presetUid}.json`);
    }

    async getRequirementPresets(userUid: string, softwareTypeUid: string, gridVersion?: string): Promise<RequirementPreset[]> {
        const userPresetsPath = this.getDataPath("users", userUid, "requirements-presets");

        if (!await this.fs.folderExists(userPresetsPath)) {
            return [];
        }

        const dirContent = await this.fs.readFolder(userPresetsPath);
        const files = dirContent.filter(file => file.isFile() && file.name.endsWith('.json'));

        const presets = await Promise.all(
            files.map(async (file) => {
                try {
                    return await this.fs.readJSON<RequirementPreset>(
                        path.join(userPresetsPath, file.name)
                    );
                } catch (err) {
                    console.error(`Error reading preset file ${file.name}:`, err);
                    return null;
                }
            })
        );

        return presets
            .filter((preset): preset is RequirementPreset => preset !== null)
            .filter(preset => softwareTypeUid === '*' || preset.softwareTypeUid === softwareTypeUid)
            .filter(preset => !gridVersion || preset.gridVersion === gridVersion)
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    async getRequirementPreset(userUid: string, presetUid: string): Promise<RequirementPreset> {
        return await this.fs.readJSON<RequirementPreset>(
            this.getRequirementPresetPath(userUid, presetUid)
        );
    }

    async pushRequirementPreset(preset: RequirementPreset): Promise<RequirementPreset> {
        const presetPath = this.getRequirementPresetPath(preset.userUid, preset.presetUid);
        const userPresetsDir = this.getDataPath("users", preset.userUid, "requirements-presets");

        if (!await this.fs.folderExists(userPresetsDir)) {
            await this.fs.makeFolder(userPresetsDir);
        }
        preset.updatedAt = new Date().toISOString();

        await this.fs.writeFile(presetPath, toJSON(preset));
        return preset;
    }

    async deleteRequirementPreset(userUid: string, presetUid: string): Promise<void> {
        await this.fs.deleteFile(this.getRequirementPresetPath(userUid, presetUid));
    }

    /* ========================
        User
       ======================== */

    getUserPath(userUid: string) {
        return this.getDataPath("users", userUid, "user.json");
    }

    async getUser(userUid: string): Promise<User> {
        return this.fs.readJSON<User>(this.getUserPath(userUid));
    }

}

export interface FileSystemProvider {
    readFolder(path: string): Promise<Dirent[]>; // list files and folders in a directory
    readJSON<T>(path: string): Promise<T>;
    readBase64(path: string): Promise<string>;
    writeFile(path: string, data: string | Buffer): Promise<any>;
    renameFile(oldPath: string, newPath: string): Promise<void>;
    moveFolder(oldPath: string, newPath: string): Promise<void>;
    deleteFile(path: string): Promise<void>;
    deleteFolder(path: string): Promise<void>;
    makeFolder(path: string, options?: any): Promise<any>;
    fileExists(path: string): Promise<boolean>;
    folderExists(path: string): Promise<boolean>;
    glob(pattern: string, basePath: string): Promise<string[]>;
}