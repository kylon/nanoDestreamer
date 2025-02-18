import { ApiClient } from './ApiClient';
import { ERROR_CODE } from './Errors';
import { logger } from './Logger';
import { Session } from './Types';
import { AxiosResponse } from 'axios';
import { execSync } from 'child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';


async function extractGuids(url: string, client: ApiClient): Promise<Array<string> | null> {

    const videoRegex = new RegExp(/https:\/\/.*\/video\/(\w{8}-(?:\w{4}-){3}\w{12})/);
    const groupRegex = new RegExp(/https:\/\/.*\/group\/(\w{8}-(?:\w{4}-){3}\w{12})/);

    const videoMatch: RegExpExecArray | null = videoRegex.exec(url);
    const groupMatch: RegExpExecArray | null = groupRegex.exec(url);

    if (videoMatch) {
        return [videoMatch[1]];
    }
    else if (groupMatch) {
        const videoNumber: number = await client.callApi(`groups/${groupMatch[1]}`, 'get')
            .then((response: AxiosResponse<any> | undefined) => response?.data.metrics.videos);
        const result: Array<string> = [];

        // Anything above $top=100 results in 400 Bad Request
        // Use $skip to skip the first 100 and get another 100 and so on
        for (let index = 0; index <= Math.floor(videoNumber / 100); index++) {
            const partial: Array<string> = await client.callApi(
                `groups/${groupMatch[1]}/videos?$skip=${100 * index}&` +
                '$top=100&$orderby=publishedDate asc', 'get')
                .then(
                    (response: AxiosResponse<any> | undefined) =>
                        response?.data.value.map((item: any) => item.id)
                );

            result.push(...partial);
        }

        return result;
    }

    return null;
}

/**
 * Parse the input text file.
 * The urls in the file can either be video urls or group urls, in which case the guids
 * will be added from oldest to newest.
 *
 * @param {string}  inputFile     path to the text file
 * @param {string}  defaultOutDir the default/fallback directory used to save the videos
 * @param {Session} session       used to call the API to get the GUIDs from group links
 *
 * @returns Array of 2 elements, 1st one being the GUIDs array, 2nd one the output directories array
 */
export async function parseInputFile(inputFile: string, defaultOutDir: string,
    session: Session): Promise<Array<Array<string>>> {
    // rawContent is a list of each line of the file
    const rawContent: Array<string> = fs.readFileSync(inputFile).toString()
        .split(/\r?\n/);
    const apiClient: ApiClient = ApiClient.getInstance(session);

    const guidList: Array<string> = [];
    const outDirList: Array<string> = [];
    // if the last line was an url set this
    let foundUrl = false;

    for (let i = 0; i < rawContent.length; i++) {
        const line: string = rawContent[i];

        if (!line.match(/\S/)) // empty line
            continue;

        // parse if line is option
        else if (line.includes('-dir')) {
            if (foundUrl) {
                const outDir: string | null = parseOption('-dir', line);

                if (outDir && checkOutDir(outDir)) {
                    outDirList.push(...Array(guidList.length - outDirList.length)
                        .fill(outDir));
                }
                else {
                    outDirList.push(...Array(guidList.length - outDirList.length)
                        .fill(defaultOutDir));
                }

                foundUrl = false;
                continue;
            }
            else {
                logger.warn(`Found options without preceding url at line ${i + 1}, skipping..`);
                continue;
            }
        }

        /* now line is not empty nor an option line.
        If foundUrl is still true last line didn't have a directory option
        so we stil need to add the default outDir to outDirList to  */
        if (foundUrl) {
            outDirList.push(...Array(guidList.length - outDirList.length)
                .fill(defaultOutDir));
            foundUrl = false;
        }

        const guids: Array<string> | null = await extractGuids(line, apiClient);

        if (guids) {
            guidList.push(...guids);
            foundUrl = true;
        }
        else {
            logger.warn(`Invalid url at line ${i + 1}, skipping..`);
        }
    }

    // if foundUrl is still true after the loop we have some url without an outDir
    if (foundUrl) {
        outDirList.push(...Array(guidList.length - outDirList.length)
            .fill(defaultOutDir));
    }

    return [guidList, outDirList];
}


// This leaves us the option to add more options (badum tss) _Luca
function parseOption(optionSyntax: string, item: string): string | null {
    const match: RegExpMatchArray | null = item.match(
        RegExp(`^\\s*${optionSyntax}\\s?=\\s?['"](.*)['"]`)
    );

    return match ? match[1] : null;
}


export function checkOutDir(directory: string): boolean {
    if (!fs.existsSync(directory)) {
        try {
            fs.mkdirSync(directory);
            logger.info('\nCreated directory: '.yellow + directory);
        }
        catch (e) {
            logger.warn('Cannot create directory: ' + directory +
                '\nFalling back to default directory..');

            return false;
        }
    }

    return true;
}


export function checkRequirements(): void {
    try {
        const copyrightYearRe = new RegExp(/\d{4}-(\d{4})/);
        const ffmpegVer: string = execSync('ffmpeg -version').toString().split('\n')[0];

        if (parseInt(copyrightYearRe.exec(ffmpegVer)?.[1] ?? '0') <= 2019) {
            process.exit(ERROR_CODE.OUTDATED_FFMPEG);
        }

        logger.verbose(`Using ${ffmpegVer}\n`);
    }
    catch (e) {
        process.exit(ERROR_CODE.MISSING_FFMPEG);
    }
}


export function ffmpegTimemarkToChunk(timemark: string): number {
    const timeVals: Array<string> = timemark.split(':');
    const hrs: number = parseInt(timeVals[0]);
    const mins: number = parseInt(timeVals[1]);
    const secs: number = parseInt(timeVals[2]);

    return (hrs * 60) + mins + (secs / 60);
}

export async function timeout(milliseconds: number): Promise<void> {
    await ( new Promise(r => setTimeout(r, milliseconds)) );
}

export function getVideoInputFileHash(inputFile: string): string {
    const fileBuffer = fs.readFileSync(inputFile);
    const hashSum = crypto.createHash('sha256');

    hashSum.update(fileBuffer);

    return hashSum.digest('hex');
}
