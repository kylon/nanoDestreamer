import { CLI_ERROR, ERROR_CODE } from './Errors';
import { checkOutDir } from './Utils';
import { logger } from './Logger';

import fs from 'fs';
import yargs from 'yargs';


export const argv: any = yargs.options({
    username: {
        alias: 'u',
        type: 'string',
        describe: 'The username used to log into Microsoft Stream (enabling this will fill in the email field for you).',
        demandOption: false
    },
    downloader: {
        alias: 'd',
        describe: 'Select ffmpeg (default) or yt-dlp as downloader',
        type: 'string',
        default: 'ffmpeg',
        demandOption: false
    },
    parallelDownloads: {
        alias: 'p',
        describe: 'Parallel fragment downloads (yt-dlp only)',
        type: 'string',
        default: '5',
        demandOption: false
    },
    inputFile: {
        alias: 'f',
        describe: 'Path to text file containing URLs and optionally outDirs. See the README for more on outDirs.',
        type: 'string',
        demandOption: false
    },
    outputDirectory: {
        alias: 'o',
        describe: 'The directory where destreamer will save your downloads.',
        type: 'string',
        default: 'videos',
        demandOption: false
    },
    keepLoginCookies: {
        alias: 'k',
        describe: 'Let Chromium cache identity provider cookies so you can use "Remember me" during login.\n' +
                  'Must be used every subsequent time you launch Destreamer if you want to log in automatically.',
        type: 'boolean',
        default: false,
        demandOption: false
    },
    verbose: {
        alias: 'v',
        describe: 'Print additional information to the console (use this before opening an issue on GitHub).',
        type: 'boolean',
        default: false,
        demandOption: false
    },
    noCleanup: {
        alias: 'nc',
        describe: 'Do not delete the downloaded video file when an FFmpeg error occurs.',
        type: 'boolean',
        default: false,
        demandOption: false
    },
    vcodec: {
        describe: 'Re-encode video track. Specify FFmpeg codec (e.g. libx265) or set to "none" to disable video.',
        type: 'string',
        default: 'copy',
        demandOption: false
    },
    acodec: {
        describe: 'Re-encode audio track. Specify FFmpeg codec (e.g. libopus) or set to "none" to disable audio.',
        type: 'string',
        default: 'copy',
        demandOption: false
    },
    format: {
        describe: 'Output container format (mkv, mp4, mov, anything that FFmpeg supports).',
        type: 'string',
        default: 'mp4',
        demandOption: false
    },
})
.wrap(120)
.check(() => noArguments())
.check((argv: any) => checkInputConflicts(argv.inputFile))
.check((argv: any) => {
    if (checkOutDir(argv.outputDirectory)) {
        return true;
    }
    else {
        logger.error(CLI_ERROR.INVALID_OUTDIR);

        throw new Error(' ');
    }
})
.argv;


function noArguments(): boolean {
    // if only 2 args no other args (0: node path, 1: js script path)
    if (process.argv.length === 2) {
        logger.error(CLI_ERROR.MISSING_INPUT_ARG, {fatal: true});

        // so that the output stays clear
        throw new Error(' ');
    }

    return true;
}


function checkInputConflicts(inputFile: string | undefined): boolean {
    // check if no input is declared or if they are declared but empty
    if (!inputFile || inputFile?.length === 0) {
        logger.error(CLI_ERROR.MISSING_INPUT_ARG);

        throw new Error(' ');
    }
    else {
        // check if inputFile doesn't end in '.txt'
        if (inputFile.substring(inputFile.length - 4) !== '.txt') {
            logger.error(CLI_ERROR.INPUTFILE_WRONG_EXTENSION);

            throw new Error(' ');
        }
        // check if the inputFile exists
        else if (!fs.existsSync(inputFile)) {
            logger.error(CLI_ERROR.INPUTFILE_NOT_FOUND);

            throw new Error(' ');
        }
    }

    return true;
}
