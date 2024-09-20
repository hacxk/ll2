import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AnyMessageContent } from '@whiskeysockets/baileys';
import fetch from 'node-fetch';
import { SendMessageDto } from 'src/dto/apiDto';
import { Readable } from 'stream';

export async function generateMessageFromContent(apiMessage: SendMessageDto): Promise<AnyMessageContent> {
    let content: AnyMessageContent;
    const mediaObjects = ["image", "video", "audio", "document"];

    switch (apiMessage.type) {
        case 'text':
            content = {
                text: apiMessage.content.text
            };
            break;

        // case 'media':
        //     if (!apiMessage.content[mediaObjects]) {
        //         throw new Error('Media object is missing in the content');
        //     }

        //     if (!apiMessage.content[mediaObjects].url && !apiMessage.content[mediaObjects].buffer) {
        //         throw new Error('Media URL or buffer is required for media messages');
        //     }

        //     const tempDir = path.join(__dirname, '..', 'temp');
        //     await fs.promises.mkdir(tempDir, { recursive: true });

        //     let filePath: string;
        //     let mediaType: string;

        //     if (apiMessage.content.media.buffer) {
        //         // Handle buffer case
        //         const fileName = `${crypto.randomBytes(16).toString('hex')}${path.extname(apiMessage.content.media.fileName || '')}`;
        //         filePath = path.join(tempDir, fileName);
        //         await fs.promises.writeFile(filePath, apiMessage.content[mediaObjects].buffer);
        //         mediaType = getMediaType(apiMessage.content[mediaObjects].fileName || '');
        //     } else if (apiMessage.content[mediaObjects].url) {
        //         // Handle URL case
        //         const response = await fetch(apiMessage.content[mediaObjects].url);
        //         const arrayBuffer = await response.arrayBuffer();
        //         const buffer = Buffer.from(arrayBuffer);
        //         const fileName = path.basename(new URL(apiMessage.content[mediaObjects].url).pathname);
        //         filePath = path.join(tempDir, fileName);
        //         await fs.promises.writeFile(filePath, buffer);
        //         mediaType = getMediaType(apiMessage.content[mediaObjects].url);
        //     } else {
        //         throw new Error('Invalid media content: neither URL nor buffer provided');
        //     }

        //     // Create a readable stream from the file
        //     const fileStream = fs.createReadStream(filePath);

        //     switch (mediaType) {
        //         case 'image':
        //             content = {
        //                 image: { stream: fileStream },
        //                 caption: apiMessage.content.caption
        //             };
        //             break;
        //         case 'video':
        //             content = {
        //                 video: { stream: fileStream },
        //                 caption: apiMessage.content.caption
        //             };
        //             break;
        //         case 'audio':
        //             content = {
        //                 audio: { stream: fileStream },
        //                 caption: apiMessage.content.caption
        //             };
        //             break;
        //         case 'document':
        //             const mimeType = getMimeType(filePath);
        //             content = {
        //                 document: { stream: fileStream },
        //                 caption: apiMessage.content.caption,
        //                 mimetype: mimeType
        //             };
        //             break;
        //         default:
        //             throw new Error(`Unsupported media type: ${mediaType}`);
        //     }

        //     // Clean up: delete the temporary file after the stream is closed
        //     fileStream.on('close', () => {
        //         fs.unlink(filePath, (err) => {
        //             if (err) console.error(`Error deleting temporary file: ${err}`);
        //         });
        //     });
        //     break;

        case 'poll':
            if (!apiMessage.content.poll) {
                throw new Error('Poll data is required for poll messages');
            }

            content = {
                poll: {
                    name: apiMessage.content.poll.name,
                    values: apiMessage.content.poll.options,
                    selectableCount: apiMessage.content.poll.selectableOptionsCount
                }
            };
            break;

        default:
            throw new Error(`Unsupported message type: ${apiMessage.type}`);
    }

    return content;
}

// Helper functions
function getMediaType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) return 'image';
    if (['.mp4', '.avi', '.mov'].includes(ext)) return 'video';
    if (['.mp3', '.wav', '.ogg'].includes(ext)) return 'audio';
    return 'document';
}

function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.pdf': return 'application/pdf';
        case '.doc': return 'application/msword';
        case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        // Add more mime types as needed
        default: return 'application/octet-stream';
    }
}
