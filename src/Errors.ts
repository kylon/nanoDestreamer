export const enum ERROR_CODE {
    UNHANDLED_ERROR,
    CANCELLED_USER_INPUT,
    MISSING_FFMPEG,
    OUTDATED_FFMPEG,
    UNK_FFMPEG_ERROR,
    INVALID_VIDEO_GUID,
    NO_SESSION_INFO
}


export const errors: { [key: number]: string } = {
    [ERROR_CODE.UNHANDLED_ERROR]: 'Unhandled error!\n' +
        'Timeout or fatal error, please check your downloads directory and try again',

    [ERROR_CODE.CANCELLED_USER_INPUT]: 'Input was cancelled by user',

    [ERROR_CODE.MISSING_FFMPEG]: 'FFmpeg is missing!\n' +
        'Destreamer requires a fairly recent release of FFmpeg to download videos',

    [ERROR_CODE.OUTDATED_FFMPEG]: 'The FFmpeg version currently installed is too old!\n' +
        'Destreamer requires a fairly recent release of FFmpeg to download videos',

    [ERROR_CODE.UNK_FFMPEG_ERROR]: 'Unknown FFmpeg error',

    [ERROR_CODE.INVALID_VIDEO_GUID]: 'Unable to get video GUID from URL',

    [ERROR_CODE.NO_SESSION_INFO]: 'Could not evaluate sessionInfo on the page'
};


export const enum CLI_ERROR {
    MISSING_INPUT_ARG = 'You must specify a URLs source. \n' +
    'Valid option is -f for input file. \n',

    INPUTFILE_WRONG_EXTENSION = 'The specified inputFile has the wrong extension \n' +
    'Please make sure to use path/to/filename.txt when useing the -f option \n',

    INPUTFILE_NOT_FOUND = 'The specified inputFile does not exists \n' +
    'Please check the filename and the path you provided \n',

    INVALID_OUTDIR = 'Could not create the default/specified output directory \n' +
    'Please check directory and permissions and try again. \n'
}
