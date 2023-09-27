import { ApiClient } from './ApiClient';
import { logger } from './Logger';
import { Video, Session } from './Types';

import { AxiosResponse } from 'axios';
import fs from 'fs';
import { parse as parseDuration, Duration } from 'iso8601-duration';
import path from 'path';
import sanitizeWindowsName from 'sanitize-filename';

function publishedDateToString(date: string): string {
    const dateJs: Date = new Date(date);
    const day: string = dateJs.getDate().toString().padStart(2, '0');
    const month: string = (dateJs.getMonth() + 1).toString(10).padStart(2, '0');

    return `${dateJs.getFullYear()}-${month}-${day}`;
}


function publishedTimeToString(date: string): string {
    const dateJs: Date = new Date(date);
    const hours: string = dateJs.getHours().toString();
    const minutes: string = dateJs.getMinutes().toString();
    const seconds: string = dateJs.getSeconds().toString();

    return `${hours}.${minutes}.${seconds}`;
}


function isoDurationToString(time: string): string {
    const duration: Duration = parseDuration(time);

    return `${duration.hours ?? '00'}.${duration.minutes ?? '00'}.${duration.seconds?.toFixed(0) ?? '00'}`;
}


function durationToTotalChunks(duration: string): number {
    const durationObj: any = parseDuration(duration);
    const hrs: number = durationObj.hours ?? 0;
    const mins: number = durationObj.minutes ?? 0;
    const secs: number = Math.ceil(durationObj.seconds ?? 0);

    return (hrs * 60) + mins + (secs / 60);
}


export async function getVideoInfo(videoGuids: Array<string>, session: Session): Promise<Array<Video>> {
    const metadata: Array<Video> = [];
    let title: string;
    let duration: string;
    let publishDate: string;
    let publishTime: string;
    let author: string;
    let authorEmail: string;
    let uniqueId: string;
    let totalChunks: number;
    let playbackUrl: string;

    const apiClient: ApiClient = ApiClient.getInstance(session);

    /* TODO: change this to a single guid at a time to ease our footprint on the
    MSS servers or we get throttled after 10 sequential reqs */
    for (const guid of videoGuids) {
        const response: AxiosResponse<any> | undefined =
            await apiClient.callApi('videos/' + guid + '?$expand=creator', 'get');

        title = sanitizeWindowsName(response?.data['name']);

        duration = isoDurationToString(response?.data.media['duration']);

        publishDate = publishedDateToString(response?.data['publishedDate']);

        publishTime = publishedTimeToString(response?.data['publishedDate']);

        author = response?.data['creator'].name;

        authorEmail = response?.data['creator'].mail;

        uniqueId = '#' + guid.split('-')[0];

        totalChunks = durationToTotalChunks(response?.data.media['duration']);

        playbackUrl = response?.data['playbackUrls']
            .filter((item: { [x: string]: string; }) =>
                item['mimeType'] == 'application/vnd.apple.mpegurl')
            .map((item: { [x: string]: string }) => {
                return item['playbackUrl'];
            })[0];

        metadata.push({
            title: title,
            duration: duration,
            publishDate: publishDate,
            publishTime: publishTime,
            author: author,
            authorEmail: authorEmail,
            uniqueId: uniqueId,
            outPath: '',
            totalChunks: totalChunks,    // Abstraction of FFmpeg timemark
            playbackUrl: playbackUrl
        });
    }

    return metadata;
}


export function createUniquePath(videos: Array<Video>, outDirs: Array<string>, format: string): Array<Video> {
    videos.forEach((video: Video, index: number) => {
        const template = '{title} - {publishDate}';
        let title: string = template;
        let finalTitle: string;
        const elementRegEx = RegExp(/{(.*?)}/g);
        let match = elementRegEx.exec(template);

        while (match) {
            const value = video[match[1] as keyof Video] as string;
            title = title.replace(match[0], value);
            match = elementRegEx.exec(template);
        }

        let i = 0;
        finalTitle = title;

        while (fs.existsSync(path.join(outDirs[index], `${finalTitle}.${format}`))) {
            finalTitle = `${title} (${++i})`;
        }

        const finalFileName = `${finalTitle}.${format}`;
        const cleanFileName = sanitizeWindowsName(finalFileName, { replacement: '_' });
        if (finalFileName !== cleanFileName) {
            logger.warn(`Not a valid Windows file name: "${finalFileName}".\nReplacing invalid characters with underscores to preserve cross-platform consistency.`);
        }

        video.outPath = path.join(outDirs[index], finalFileName);

    });

    return videos;
}
