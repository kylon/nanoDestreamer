![destreamer](assets/logo.png)

# Nano-Destreamer

stripped down version of destreamer with yt-dlp

## Disclaimer

Hopefully this doesn't break the end user agreement for Microsoft Stream. Since we're simply saving the HLS stream to disk as if we were a browser, this does not abuse the streaming endpoints. However i take no responsibility if either Microsoft or your Office 365 admins request a chat with you in a small white room.

## Prereqs

- **Node.js**: recent version of Node.js
- **ffmpeg**: recent version ([how to install](https://github.com/kylon/Sharedown/wiki/How-to-install-FFmpeg))
- **yt-dlp**: recent version ([how to install](https://github.com/kylon/Sharedown/wiki/How-to-install-YTdlp))
- **git**: recent version

## Limits and limitations

Running inside **Cygwin/MinGW/MSYS** may fail, please use **cmd.exe** or **PowerShell** if you're on Windows.

**WSL** (Windows Subsystem for Linux) is not supported.

## Avoiding duplicates

what is a download session?

you create a txt file with a list of urls to download

this list is a download session, if you change the list (add/remove urls), a new session will start


if video urls input file changes, the _done_ file will be reset and you will get duplicates

intended usage:

create your urls list file and do not touch it until all downloads in the list are complete (even if it crashes and you restart it)

once all finished, create a new urls input file (remove all existing urls)

somewhat limited feature, but more than enough for this

## How to build

To build destreamer clone this repository, install dependencies and run the build script -

```sh
$ git clone https://github.com/snobu/destreamer
$ cd destreamer
$ npm install or yarn install
$ npm run build or yarn build
```

## Usage

Example command:
```sh
$ node build/nanoDestreamer.js -f vidUrlsFile.txt -d ytdlp
```

Passing `--username` is optional. It's there to make logging in faster (the username field will be populated automatically on the login form).

You can use an absolute path for `-o` (output directory), for example `/home/name/videos`.

### Input file
You can create a `.txt` file containing your video URLs, one video per line. The text file can have any name, followed by the `.txt` extension.

Also accept Microsoft Teams Groups url so if your Organization placed the videos you are interested in a group you can copy the link and Destreamer will download all the videos it can inside it! A group url looks like this https://web.microsoftstream.com/group/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX

Example
```
https://web.microsoftstream.com/video/xxxxxxxx-aaaa-xxxx-xxxx-xxxxxxxxxxxx
 -dir="videos/lessons/week1"
https://web.microsoftstream.com/video/xxxxxxxx-aaaa-xxxx-xxxx-xxxxxxxxxxxx
 -dir="videos/lessons/week2"
```

By default, downloads are saved in `videos` folder in the same directory where destreamer is executed, unless specified by `-o` (output directory).

## KNOWN BUGS

maybe a few?

this is a quick job not intended to be supported as a destreamer fork, just personal needs
