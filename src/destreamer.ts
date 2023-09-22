import { argv } from './CommandLineParser';
import { ERROR_CODE } from './Errors';
import { setProcessEvents } from './Events';
import { logger } from './Logger';
import { TokenCache, refreshSession } from './TokenCache';
import { Video, Session } from './Types';
import {checkRequirements, ffmpegTimemarkToChunk, parseInputFile, timeout} from './Utils';
import { getVideoInfo, createUniquePath } from './VideoUtils';

import fs from 'fs';
import puppeteer, {Browser, Page, Target} from 'puppeteer';
import { ApiClient } from './ApiClient';


const { FFmpegCommand, FFmpegInput, FFmpegOutput } = require('fessonia')();
const tokenCache: TokenCache = new TokenCache();
export const chromeCacheFolder = '.chrome_data';


async function init(): Promise<void> {
    setProcessEvents(); // must be first!

    if (argv.verbose) {
        logger.level = 'verbose';
    }

    checkRequirements();

    if (argv.username) {
        logger.info(`Username: ${argv.username}`);
    }
}


async function DoInteractiveLogin(url: string, username?: string): Promise<Session> {

    logger.info('Launching headless Chrome to perform the OpenID Connect dance...');

    const browser: Browser = await puppeteer.launch({
        headless: false,
        userDataDir: (argv.keepLoginCookies) ? chromeCacheFolder : undefined,
        args: [
            '--disable-dev-shm-usage',
            '--fast-start',
            '--no-sandbox'
        ]
    });
    const page: Page = (await browser.pages())[0];

    logger.info('Navigating to login page...');
    await page.goto(url, { waitUntil: 'load' });

    try {
        if (username) {
            await page.waitForSelector('input[type="email"]', {timeout: 3000});
            await page.keyboard.type(username);
            await page.click('input[type="submit"]');
        }
        else {
            /* If a username was not provided we let the user take actions that
            lead up to the video page. */
        }
    }
    catch (e) {
        /* If there is no email input selector we aren't in the login module,
        we are probably using the cache to aid the login.
        It could finish the login on its own if the user said 'yes' when asked to
        remember the credentials or it could still prompt the user for a password */
    }

    await browser.waitForTarget((target: Target) => target.url().endsWith('microsoftstream.com/'), { timeout: 150000 });
    logger.info('We are logged in.');

    let session: Session | null = null;
    let tries = 1;
    while (!session) {
        try {
            let sessionInfo: any;
            session = await page.evaluate(
                () => {
                    return {
                        AccessToken: sessionInfo.AccessToken,
                        ApiGatewayUri: sessionInfo.ApiGatewayUri,
                        ApiGatewayVersion: sessionInfo.ApiGatewayVersion
                    };
                }
            );
        }
        catch (error) {
            if (tries > 5) {
                process.exit(ERROR_CODE.NO_SESSION_INFO);
            }

            session = null;
            tries++;
            await timeout(3000);
        }
    }

    tokenCache.Write(session);
    logger.info('Wrote access token to token cache.');
    logger.info("At this point Chromium's job is done, shutting it down...\n");

    await browser.close();

    return session;
}


async function downloadVideo(videoGUIDs: Array<string>, outputDirectories: Array<string>, session: Session): Promise<void> {

    logger.info('Fetching videos info... \n');
    const videos: Array<Video> = createUniquePath (
        await getVideoInfo(videoGUIDs, session, argv.closedCaptions),
        outputDirectories, argv.format
        );

    for (const [index, video] of videos.entries()) {
        if (argv.keepLoginCookies && index !== 0) {
            logger.info('Trying to refresh token...');
            session = await refreshSession('https://web.microsoftstream.com/video/' + videoGUIDs[index]);
            ApiClient.getInstance().setSession(session);
        }

        logger.info(`\nDownloading Video: ${video.title} \n`);
        logger.verbose('Extra video info \n' +
        '\t Video m3u8 playlist URL: '.cyan + video.playbackUrl + '\n' +
        '\t Video subtitle URL (may not exist): '.cyan + video.captionsUrl + '\n' +
        '\t Video total chunks: '.cyan + video.totalChunks + '\n');

        logger.info('Spawning ffmpeg with access token and HLS URL. This may take a few seconds...\n\n');
        if (!process.stdout.columns) {
            logger.warn(
                'Unable to get number of columns from terminal.\n' +
                'This happens sometimes in Cygwin/MSYS.\n' +
                'No progress bar can be rendered, however the download process should not be affected.\n\n' +
                'Please use PowerShell or cmd.exe to run destreamer on Windows.'
            );
        }

        const headers: string = 'Authorization: Bearer ' + session.AccessToken;
        const ffmpegInpt: any = new FFmpegInput(video.playbackUrl, new Map([
            ['headers', headers]
        ]));
        const ffmpegOutput: any = new FFmpegOutput(video.outPath, new Map([
            argv.acodec === 'none' ? ['an', null] : ['c:a', argv.acodec],
            argv.vcodec === 'none' ? ['vn', null] : ['c:v', argv.vcodec],
            ['n', null]
        ]));
        const ffmpegCmd: any = new FFmpegCommand();

        const cleanupFn: () => void = () => {
           if (argv.noCleanup) {
               return;
           }

            try {
                fs.unlinkSync(video.outPath);
            }
            catch (e) {
                // Future handling of an error (maybe)
            }
        };

        // prepare ffmpeg command line
        ffmpegCmd.addInput(ffmpegInpt);
        ffmpegCmd.addOutput(ffmpegOutput);
        if (argv.closedCaptions && video.captionsUrl) {
            const captionsInpt: any = new FFmpegInput(video.captionsUrl, new Map([
                ['headers', headers]
            ]));

            ffmpegCmd.addInput(captionsInpt);
        }

        ffmpegCmd.on('update', async (data: any) => {
            const currentChunks: number = ffmpegTimemarkToChunk(data.out_time);

            process.stdout.write(`-- Speed: ${data.bitrate}, Cursor: ${data.out_time}, Progress: ${currentChunks}\r`);
        });

        process.on('SIGINT', cleanupFn);

        // let the magic begin...
        await new Promise((resolve: any) => {
            ffmpegCmd.on('error', (error: any) => {
                cleanupFn();

                logger.error(`FFmpeg returned an error: ${error.message}`);
                process.exit(ERROR_CODE.UNK_FFMPEG_ERROR);
            });

            ffmpegCmd.on('success', () => {
                logger.info(`\nDownload finished: ${video.outPath} \n`);
                resolve();
            });

            ffmpegCmd.spawn();
        });

        process.removeListener('SIGINT', cleanupFn);
    }
}


async function main(): Promise<void> {
    await init(); // must be first

    let session: Session;
    // eslint-disable-next-line prefer-const
    session = tokenCache.Read() ?? await DoInteractiveLogin('https://web.microsoftstream.com/', argv.username);

    logger.verbose('Session and API info \n' +
        '\t API Gateway URL: '.cyan + session.ApiGatewayUri + '\n' +
        '\t API Gateway version: '.cyan + session.ApiGatewayVersion + '\n');

    let videoGUIDs: Array<string>;
    let outDirs: Array<string>;

    logger.info('Parsing input file');
    [videoGUIDs, outDirs] =  await parseInputFile(argv.inputFile!, argv.outputDirectory, session);

    logger.verbose('List of GUIDs and corresponding output directory \n' +
        videoGUIDs.map((guid: string, i: number) =>
            `\thttps://web.microsoftstream.com/video/${guid} => ${outDirs[i]} \n`).join(''));


    downloadVideo(videoGUIDs, outDirs, session);
}


main();
