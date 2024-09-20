import { ApiProperty } from '@nestjs/swagger';

export class CreateConnectionDto {
    @ApiProperty()
    userId: string;

    @ApiProperty({ required: false })
    pairingCode?: string;
}

export class GeneratePairingCodeDto {
    @ApiProperty()
    userId: string;

    @ApiProperty()
    phoneNumber: string;
}

export class SendMessageDto {
    userId: string;
    recipients: string[];
    type: 'text' | 'media' | 'poll';
    content: {
        text?: string;
        media?: {
            buffer?: string;
            url?: string;
            fileName?: string;
        };
        caption?: string;
        poll?: {
            name: string;
            options: string[];
            selectableOptionsCount: number;
        };
    };
    scheduleDate?: Date;
}

export class SendMessageResponseDto {
    success: boolean;
    messageId: string;
    timestamp: Date;
}


export class ErrorResponseDto {
    @ApiProperty()
    success: boolean;

    @ApiProperty()
    message: string;

    @ApiProperty({ required: false })
    error?: string;
}


// Recipient type
export interface Recipient {
    id: string;
    name: string;
    // Add other recipient properties as needed
}

// Base message interface
export interface BaseMessage {
    recipients: string[];
    scheduleDate: Date | null;
}

// Text message
export interface TextMessage extends BaseMessage {
    type: 'text';
    content: {
        text: string;
    };
}

// Media message
export interface MediaMessage extends BaseMessage {
    type: 'media';
    content: {
        image: {
            url: string;
        };
        caption?: string;
    };
}

// Poll option
export interface PollOption {
    text: string;
}

// Poll message
export interface PollMessage extends BaseMessage {
    type: 'poll';
    content: {
        poll: {
            name: string;
            options: string[];
            selectableOptionsCount: number;
        };
    };
}

type MediaType = 'image' | 'audio' | 'video' | 'document';

export interface TextMessage {
    text: string;
}

type MediaContent = {
    [K in MediaType]?: {
        url?: string
        buffer?: Buffer;
    };
};

export interface MediaMessage {
    media: MediaContent;
    caption?: string;
}

export interface PollMessage {
    poll: {
        name: string;
        options: string[];
        selectableOptionsCount: number;
    };
}

type MessageContent = TextMessage | MediaMessage | PollMessage;

export interface APIMessage {
    content: MessageContent;
    recipients: string[];
    scheduleDate: Date | null;
}

export interface ScheduledMessage {
    id?: number;
    userId: string;
    type: string;
    content: string;
    recipients: string;
    scheduleDate: Date;
    status: 'pending' | 'sent' | 'failed';
    failedReason?: string;
}
