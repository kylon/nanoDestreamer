export type Session = {
    AccessToken: string;
    ApiGatewayUri: string;
    ApiGatewayVersion: string;
}


export type Video = {
    title: string;
    duration: string;
    publishDate: string;
    publishTime: string;
    author: string;
    authorEmail: string;
    uniqueId: string;
    outPath: string;
    totalChunks: number;    // Abstraction of FFmpeg timemark
    playbackUrl: string;
}
