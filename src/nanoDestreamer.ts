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
import {ChildProcess, spawn} from "node:child_process";
import _path from 'node:path';
import events from "node:events";

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

    const videos: Array<Video> = createUniquePath(await getVideoInfo(videoGUIDs, session), outputDirectories, argv.format);
    let ytdlpProcHandle: ChildProcess|null = null;
    let _stoppingProcess = false;

    for (const [index, video] of videos.entries()) {
        if (argv.downloader === 'ytdlp' && _stoppingProcess)
            break;

        if (argv.keepLoginCookies && index !== 0) {
            logger.info('Trying to refresh token...');
            session = await refreshSession('https://web.microsoftstream.com/video/' + videoGUIDs[index]);
            ApiClient.getInstance().setSession(session);
        }

        logger.info(`\nDownloading Video: ${video.title} \n`);
        logger.verbose('Extra video info \n' +
        '\t Video m3u8 playlist URL: '.cyan + video.playbackUrl + '\n' +
        '\t Video total chunks: '.cyan + video.totalChunks + '\n');

        const headers: string = 'Authorization: Bearer ' + session.AccessToken;
        const cleanupFn: () => void = () => {
            if (argv.downloader === 'ytdlp' && ytdlpProcHandle !== null) {
                _stoppingProcess = true;

                if (process.platform === 'win32') {
                    // @ts-ignore
                    spawn('taskkill', ['/pid', ytdlpProcHandle.pid, '/f', '/t']);

                } else if (!ytdlpProcHandle.kill()) {
                    logger.error('Failed to send kill signal to download process');
                }
            }

            if (argv.noCleanup)
                return;

            try {
                if (fs.existsSync(video.outPath))
                    fs.unlinkSync(video.outPath);
            } catch (e) {}
        };

        process.on('SIGINT', cleanupFn);

        if (argv.downloader === 'ffmpeg') {
            logger.info('Spawning ffmpeg with access token and HLS URL. This may take a few seconds...\n\n');

            const ffmpegInpt: any = new FFmpegInput(video.playbackUrl, new Map([
                ['headers', headers]
            ]));
            const ffmpegOutput: any = new FFmpegOutput(video.outPath, new Map([
                argv.acodec === 'none' ? ['an', null] : ['c:a', argv.acodec],
                argv.vcodec === 'none' ? ['vn', null] : ['c:v', argv.vcodec],
                ['n', null]
            ]));
            const ffmpegCmd: any = new FFmpegCommand();

            ffmpegCmd.addInput(ffmpegInpt);
            ffmpegCmd.addOutput(ffmpegOutput);

            // let the magic begin...
            await new Promise((resolve: any) => {
                ffmpegCmd.on('update', async (data: any) => {
                    const currentChunks: number = ffmpegTimemarkToChunk(data.out_time);

                    process.stdout.write(`-- Speed: ${data.bitrate}, Cursor: ${data.out_time}, Progress: ${currentChunks}\r`);
                });

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
        } else {
            logger.info('Spawning yt-dlp with access token and HLS URL. This may take a few seconds...\n\n');

            try {
                const args = ['--no-part', '-N', argv.parallelDownloads, '-v', video.playbackUrl, '--add-header', headers];
                const outFPath = _path.parse(video.outPath);
                const closePromiseEvt = new events.EventEmitter();
                const outFolder = outFPath.dir;
                let tmpFold: string = '';
                let tmpOutFile: string = '';
                let filename: string = '';

                filename = outFPath.base;
                tmpFold = _path.normalize(_path.join(outFolder, 'ndsTmp'));
                tmpOutFile = _path.normalize(_path.join(tmpFold, filename));

                if (fs.existsSync(tmpFold))
                    fs.rmSync(tmpFold, {recursive: true, force: true});

                fs.mkdirSync(tmpFold);
                args.push('-o', tmpOutFile);

                ytdlpProcHandle = spawn('yt-dlp', args);

                // @ts-ignore
                ytdlpProcHandle.stdout.on('data', (data: any) => {
                    if (_stoppingProcess)
                        return;

                    logger.info(data.toString());
                });

                // @ts-ignore
                ytdlpProcHandle.stderr.on('data', (data: any) => {
                    if (_stoppingProcess)
                        return;

                   const outStr = data.toString();

                   if (!outStr.startsWith('frame=')) {
                       logger.verbose(outStr);
                       return;
                   }

                    process.stdout.write(`-- ytdlp: ${outStr}`);
                });

                // @ts-ignore
                ytdlpProcHandle.on('close', (code: number|null) => {
                    try {
                        if (code !== 0) {
                            logger.error(`ytdlp exit code: ${code}`);
                            closePromiseEvt.emit('ytdlp-close');
                            return;
                        }

                        const files = fs.readdirSync(tmpFold);
                        let found = false;

                        for (const f of files) {
                            if (!f.includes(filename))
                                continue;

                            fs.copyFileSync(tmpOutFile, video.outPath);
                            found = true;
                            break;
                        }

                        if (!found)
                            logger.error(`Cannot find video file in output folder!\n\nSrc:\n${tmpOutFile}\n\nDest:\n${video.outPath}`);

                    } catch (e: any) {
                        logger.error(`YT-dlp: download failed:\n${e.message}`);

                    } finally {
                        if (fs.existsSync(tmpFold))
                            fs.rmSync(tmpFold, {recursive: true, force: true});

                        closePromiseEvt.emit('ytdlp-close');
                    }
                });

                // probably the worst way to achieve this, but this app is dead in ~4 months, so who cares :)
                await new Promise((resolve: any) => {
                    closePromiseEvt.on('ytdlp-close', () => {
                        resolve();
                    });
                });
            } catch (e: any) {
                logger.error(`ytdlp download failed: ${e.message}`);
            }
        }

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

    await downloadVideo(videoGUIDs, outDirs, session);
}


main();
