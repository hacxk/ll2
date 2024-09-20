import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    WASocket,
    AnyMessageContent,
    proto,
    delay,
    GroupMetadata,
    WAMessage,
    generateForwardMessageContent,
    downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import { pino } from 'pino';
import * as qrcode from 'qrcode';
import * as phoneNumber from 'libphonenumber-js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SqliteHelper } from './sqlite.helper';
import { APIMessage, ScheduledMessage, SendMessageDto } from 'src/dto/apiDto';
import { buffer } from 'stream/consumers';
import { generateMessageFromContent } from 'src/utils/buffer';
import { Cron } from '@nestjs/schedule';

interface ConnectionStatus {
    isConnected: boolean;
    lastConnected: Date | null;
    lastDisconnected: Date | null;
}

interface newGroupMetaData extends GroupMetadata {
    imageUrl?: string | null;
    pendingPfpFetch?: boolean;
}

type UserGroups = Record<string, newGroupMetaData>;

@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
    private connections: Map<string, WASocket> = new Map();
    private qrCallbacks: Map<string, (qr: string) => void> = new Map();
    private connectionStatuses: Map<string, ConnectionStatus> = new Map();
    private qrCodes: Map<string, string> = new Map();
    private qrPromises: Map<string, { resolve: (value: string) => void, reject: (reason?: any) => void }> = new Map();
    private authFolder = './whatsapp-auth';
    private waUserGroups: Map<string, UserGroups> = new Map();

    private mediaStoragePath: string = './media_storage';

    constructor(
        private eventEmitter: EventEmitter2,
        private database: SqliteHelper
    ) { }

    async onModuleInit() {
        if (!fs.existsSync(this.authFolder)) {
            fs.mkdirSync(this.authFolder, { recursive: true });
        }
        await delay(5000);
        this.initializeValidConnections();
    }

    async onModuleDestroy() {
        for (const [userId] of this.connections) {
            await this.closeConnection(userId);
        }
    }

    private async initializeValidConnections() {
        try {
            await this.database.runQuery(`
    CREATE TABLE IF NOT EXISTS scheduled_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        recipients TEXT NOT NULL,
        scheduleDate DATETIME NOT NULL,
        status TEXT DEFAULT 'pending',
        failedReason TEXT,
        scheduledAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);


            await this.database.runQuery(`
                CREATE TABLE IF NOT EXISTS user_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT UNIQUE,
                    name TEXT,
                    number TEXT,
                    avatar TEXT,
                    isValid BOOLEAN,
                    isLoggedIn BOOLEAN
                )
            `);
            // Fetch all userIds where isValid is true
            const validUsers = await this.database.getValues('user_data', ['userId'], { isValid: true });

            // Iterate over each userId and initialize the connection
            for (const user of validUsers) {
                await this.initializeConnection(user.userId);
            }
        } catch (error) {
            console.error("Error initializing valid connections:", error);
        }
    }

    @Cron('*/1 * * * *')
    async handleScheduledMessages() {
        console.log('[Cron] Checking for scheduled messages at:', new Date());
        const currentTime = new Date();
        const fiveMinutesBefore = new Date(currentTime.getTime() - 5 * 60 * 1000);

        try {
            const allMessages = await this.database.getValues('scheduled_messages', ['*'])
                .catch(error => {
                    throw new Error(`Failed to fetch all messages: ${error.message}`);
                });
            console.log('[Cron] All scheduled messages:', allMessages);

            // Fetch all pending messages
            const pendingMessages = await this.database.getValues(
                'scheduled_messages',
                ['*'],
                { status: 'pending' }
            ).catch(error => {
                throw new Error(`Failed to fetch pending scheduled messages: ${error.message}`);
            });
            console.log('[Cron] All pending messages:', pendingMessages);

            // Filter pending messages by date range
            const scheduledMessages = pendingMessages.filter(message => {
                const scheduleDate = new Date(message.scheduleDate);
                return scheduleDate >= fiveMinutesBefore && scheduleDate <= currentTime;
            });
            console.log('[Cron] Pending scheduled messages within time range:', scheduledMessages);

            for (const message of scheduledMessages) {
                try {
                    await this.sendScheduledMessage(message)
                        .catch(error => {
                            throw new Error(`Failed to send scheduled message: ${error.message}`);
                        });

                    await this.updateScheduledMessageStatus(message.id, 'sent')
                        .catch(error => {
                            throw new Error(`Failed to update message status: ${error.message}`);
                        });
                } catch (messageError) {
                    console.error(`[Cron] Error processing message ${message.id}:`, messageError.message);
                    await this.updateScheduledMessageStatus(message.id, 'failed', messageError.message)
                        .catch(updateError => {
                            console.error(`[Cron] Failed to update status for failed message ${message.id}:`, updateError.message);
                        });
                }
            }
        } catch (error) {
            console.error('[Cron] Error handling scheduled messages:', error.message);
        }
    }


    async createConnection(userId: string): Promise<string> {
        if (this.isConnected(userId)) {
            throw new Error('User is already connected');
        }

        return new Promise((resolve, reject) => {
            this.qrPromises.set(userId, { resolve, reject });
            this.initializeConnection(userId);
        });
    }

    private async initializeConnection(userId: string): Promise<string> {

        if (this.connections.get(userId)) {
            return "Already Connected!";
        }

        try {
            const userAuthFolder = this.authFolder + '/' + userId;

            const { state, saveCreds } = await useMultiFileAuthState(userAuthFolder);

            console.log(`[WhatsApp] Initializing connection for user ${userId} Session path: ${userAuthFolder}`);

            try {
                await this.database.runQuery(`
                UPDATE user_data 
                SET isLoggedIn = ?
                WHERE userId = ?;
            `, [true, userId]);
            } catch (error) {
                console.error(`[WhatsApp] Database error for user ${userId}:`, error);
                throw new Error('Database operation failed');
            }

            const socket = makeWASocket({
                browser: ['Chrome (MacOS)', 'Chrome', '129.0.6668.58'],
                printQRInTerminal: false,
                qrTimeout: 15000,
                auth: state,
                logger: pino({ level: "silent" }),
            });

            return new Promise((resolve, reject) => {
                socket.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;

                    try {
                        if (qr) {
                            await this.handleQRCode(userId, qr, resolve);
                        }

                        if (connection === 'close') {
                            await this.handleClosedConnection(userId, lastDisconnect);
                        } else if (connection === 'open') {
                            await this.handleOpenConnection(userId, socket);
                        }
                    } catch (error) {
                        console.error(`[WhatsApp] Error in connection update for user ${userId}:`, error);
                        reject(error);
                    }
                });

                socket.ev.on('creds.update', saveCreds);

                socket.ev.on('messages.upsert', async (m) => {
                    try {
                        if (m.type === 'notify') {
                            await this.handleIncomingMessages(userId, m.messages);
                        }
                    } catch (error) {
                        console.error(`[WhatsApp] Error handling incoming messages for user ${userId}:`, error);
                    }
                });

                socket.ev.on('groups.upsert', async (groups) => {
                    try {
                        await this.handleGroupsUpsert(userId, groups);
                    } catch (error) {
                        console.error(`[WhatsApp] Error handling groups upsert for user ${userId}:`, error);
                    }
                });

                socket.ev.on('groups.update', async (updates) => {
                    try {
                        await this.handleGroupsUpdate(userId, updates);
                    } catch (error) {
                        console.error(`[WhatsApp] Error handling groups update for user ${userId}:`, error);
                    }
                });

                socket.ev.on('group-participants.update', async (update) => {
                    try {
                        await this.handleGroupParticipantsUpdate(userId, update, socket);
                    } catch (error) {
                        console.error(`[WhatsApp] Error handling group participants update for user ${userId}:`, error);
                    }
                });

                this.connections.set(userId, socket);
                console.log(`[WhatsApp] Socket created and stored for user ${userId}`);
            });
        } catch (error) {
            console.error(`[WhatsApp] Fatal error initializing connection for user ${userId}:`, error);
            throw error;
        }
    }


    async handleQRCode(userId, qr, resolve) {
        console.log(`[WhatsApp] Generating QR code for user ${userId}`);
        const qrBase64 = await this.generateQRCode(qr);
        this.eventEmitter.emit(`qr.${userId}`, qrBase64);
        console.log(`[WhatsApp] QR code generated successfully for user ${userId}`);
        resolve(qrBase64);
    }

    async handleClosedConnection(userId: string, lastDisconnect: any) {
        this.qrCodes.delete(userId);
        await this.updateUserValidity(userId, false);
        this.connectionStatuses.delete(userId);
        this.connections.delete(userId);

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(lastDisconnect)
        if (statusCode === 401) {

            await this.database.runQuery(`
        UPDATE user_data 
        SET isValid = ?, isLoggedIn = ?
        WHERE userId = ?;
    `, [false, false, userId]);

            console.log(`[WhatsApp] Unauthorized access for user ${userId}. Setting isValid to false and deleting auth folder.`);
            await this.deleteAuthFolder(userId);
            this.connectionStatuses.delete(userId);
        } else if (shouldReconnect) {
            if (statusCode === DisconnectReason.timedOut) {
                this.eventEmitter.emit(`qr.${userId}`, "expired!");
                console.log(`[WhatsApp] Reconnecting Stoped for user ${userId}...`);
                // if ((lastDisconnect?.error as Boom).isBoom) {
                //     await this.initializeConnection(userId);
                // }
                return;
            } else if ((lastDisconnect?.error as Boom)?.message.toLowerCase() === 'user requested!') {
                console.log(`[WhatsApp] Reconnecting Stoped for user User Closed ${userId}...`);
                return;
            } else if (statusCode === DisconnectReason.badSession) {
                await this.deleteAuthFolder(userId);
                return;
            } else if (statusCode === 405) {
                await this.deleteAuthFolder(userId);
                return;
            }
            this.eventEmitter.emit(`qr.${userId}`, `Reconnecting!`);
            console.log(`[WhatsApp] Reconnecting for user ${userId}...`);
            await this.initializeConnection(userId);
        } else {
            console.log(`[WhatsApp] Connection closed for user ${userId}. Logged out.`);
            await this.deleteAuthFolder(userId);
            this.connectionStatuses.delete(userId);
        }

        this.updateConnectionStatus(userId, false);
    }

    async handleOpenConnection(userId: string, socket: WASocket) {
        console.log(`[WhatsApp] Connection opened successfully for user ${userId}`);
        this.eventEmitter.emit(`qr.${userId}`, `Connected!`);
        this.updateConnectionStatus(userId, true);
        this.qrCodes.delete(userId);
        await this.updateUserGroups(userId, socket);
        this.schedulePfpFetching(userId);

        try {
            const existingUser = await this.database.getValues('user_data', ['*'], { userId });

            const userData = await this.getUserData(socket);

            if (existingUser.length === 0) {
                await this.insertNewUser(userId, userData);
            } else {
                await this.updateExistingUser(userId, userData);
            }

            console.log(`[Database] User data for ${userId} processed successfully`);

            this.setupPeriodicReset(userId, socket);
        } catch (error) {
            console.error(`[Database] Error processing user data for ${userId}:`, error);
        }
    }

    async updateUserGroups(userId: string, socket: WASocket) {
        const existingGroups = this.waUserGroups.get(userId) || {};
        const newGroups = await socket.groupFetchAllParticipating();

        const updatedGroups = {};

        for (const [groupId, newGroup] of Object.entries(newGroups)) {
            if (existingGroups[groupId]) {
                // Group exists, update with new information
                updatedGroups[groupId] = this.mergeGroupData(existingGroups[groupId], newGroup);
            } else {
                // New group, add it
                updatedGroups[groupId] = {
                    ...newGroup,
                    pendingPfpFetch: true,
                    imageUrl: null
                };
            }
        }

        // Check for removed groups
        for (const groupId of Object.keys(existingGroups)) {
            if (!newGroups[groupId]) {
                console.log(`[WhatsApp] Group ${groupId} no longer exists for user ${userId}`);
            }
        }

        this.waUserGroups.set(userId, updatedGroups);
        console.log(`[WhatsApp] Updated groups for user ${userId}`);

        // Schedule profile picture fetching for new or updated groups
        this.schedulePfpFetching(userId);
    }

    private mergeGroupData(existingGroup: newGroupMetaData, newGroup: newGroupMetaData): newGroupMetaData {
        return {
            ...existingGroup,
            ...newGroup,
            participants: this.mergeParticipants(existingGroup.participants, newGroup.participants),
            imageUrl: existingGroup.imageUrl, // Preserve existing image URL
            pendingPfpFetch: existingGroup.pendingPfpFetch || false
        };
    }

    private mergeParticipants(existingParticipants: any[], newParticipants: any[]): any[] {
        const mergedParticipants = [...newParticipants];

        existingParticipants.forEach(existingParticipant => {
            const index = mergedParticipants.findIndex(p => p.id === existingParticipant.id);
            if (index === -1) {
                mergedParticipants.push(existingParticipant);
            } else {
                // Preserve additional properties that might have been added
                mergedParticipants[index] = { ...existingParticipant, ...mergedParticipants[index] };
            }
        });

        return mergedParticipants;
    }


    async getUserData(socket: WASocket) {
        return {
            name: socket.user.name || 'undefined',
            number: socket.user.id.includes(':') ? socket.user.id.split(':')[0] : socket.user.id.split('@')[0],
            avatar: await socket.profilePictureUrl(socket.user.id, "image")
        };
    }

    async updateUserValidity(userId: string, isValid: boolean) {
        await this.database.runQuery(`
        UPDATE user_data 
        SET isValid = ?
        WHERE userId = ?;
    `, [isValid, userId]);
    }

    async insertNewUser(userId: string, userData: any) {
        await this.database.runQuery(`
        INSERT INTO user_data (userId, isValid, name, number, avatar) 
        VALUES (?, true, ?, ?, ?);
    `, [userId, userData.name, userData.number, userData.avatar]);
        console.log(`[Database] New user ${userId} inserted successfully`);
    }

    async updateExistingUser(userId: string, userData: any) {
        await this.database.runQuery(`
        UPDATE user_data 
        SET isValid = true, name = ?, number = ?, avatar = ?
        WHERE userId = ?;
    `, [userData.name, userData.number, userData.avatar, userId]);
        console.log(`[Database] User ${userId} updated successfully`);
    }

    setupPeriodicReset(userId: string, socket: WASocket) {
        setInterval(async () => {
            console.log(`[WhatsApp] Initiating periodic connection reset for user ${userId}`);
            socket.end(new Error('Nope!'));
        }, 25 * 60 * 1000);
    }

    async closeConnection(userId: string): Promise<void> {
        const socket = this.connections.get(userId);
        if (socket) {
            socket.end(new Error('User Requested!'));
            this.connections.delete(userId);
            this.updateConnectionStatus(userId, false);
            console.log(`Connection closed for user: ${userId}`);
        }
    }

    async logout(userId: string): Promise<void> {
        const socket = this.connections.get(userId);
        if (socket) {
            await socket.logout();
        }
        await this.closeConnection(userId);
        await this.deleteAuthFolder(userId);
        this.connectionStatuses.delete(userId);
        console.log(`Logged out user: ${userId}`);
    }

    async sendScheduledMessage(data: ScheduledMessage) {
        const socket = this.connections.get(data.userId);
        if (!socket) {
            try {
                await this.initializeConnection(data.userId);
            } catch (error) {
                console.error(`Failed to initialize connection for user ${data.userId}:`, error);
                await this.updateScheduledMessageStatus(data.id, 'failed', 'Failed to initialize connection');
                return;
            }
        }

        await delay(2000);
        const status = this.connectionStatuses.get(data.userId);
        if (!status || !status.isConnected) {
            console.log(`User ${data.userId} is not connected. Cannot send scheduled message.`);
            await this.updateScheduledMessageStatus(data.id, 'failed', 'User not connected');
            return;
        }

        try {
            const content = JSON.parse(data.content);
            const recipients = JSON.parse(data.recipients);

            for (const recipient of recipients) {
                const formattedRecipient = recipient.includes('@') ? recipient : `${recipient}@s.whatsapp.net`;
                await socket.sendMessage(formattedRecipient, content);
            }

            await this.updateScheduledMessageStatus(data.id, 'sent');
        } catch (error) {
            console.error(`Failed to send scheduled message for user ${data.userId}:`, error);
            await this.updateScheduledMessageStatus(data.id, 'failed', error.message);
        }
    }


    private async updateScheduledMessageStatus(messageId: number, status: 'sent' | 'failed', failedReason?: string) {
        try {
            await this.database.runQuery(`
            UPDATE scheduled_messages
            SET status = ?, failedReason = ?
            WHERE id = ?;
        `, [status, failedReason || null, messageId]);
            console.log(`Updated status for scheduled message ${messageId} to ${status}`);
        } catch (error) {
            console.error(`Failed to update status for scheduled message ${messageId}:`, error);
        }
    }


    async sendMessage(
        messageObject: SendMessageDto
    ): Promise<{ messageId: string; timestamp: Date; status: string }> {
        const socket = this.connections.get(messageObject.userId);
        if (!socket) {
            await this.initializeConnection(messageObject.userId);
        }

        const scheduledDate = new Date(messageObject.scheduleDate);
        let messageId: string | null = null;
        let status = 'pending';
        let failedReason: string | null = null;

        // Handle scheduling if a date is provided
        if (messageObject.scheduleDate && scheduledDate > new Date()) {
            const contentJSON = JSON.stringify(messageObject.content);
            const recipientsJSON = JSON.stringify(messageObject.recipients);

            try {
                const result = await this.database.runQuery(`
                INSERT INTO scheduled_messages (userId, type, content, recipients, scheduleDate, status)
                VALUES (?, ?, ?, ?, ?, ?);
            `, [messageObject.userId, messageObject.type, contentJSON, recipientsJSON, messageObject.scheduleDate, status]);

                messageId = result.lastID.toString();
                console.log(`Message scheduled for ${messageObject.scheduleDate}`);
            } catch (error) {
                console.error('Error scheduling message:', error);
                failedReason = 'Failed to schedule message';
                status = 'failed';
            }
        } else {
            // Send immediately
            for (const recipient of messageObject.recipients) {
                try {
                    const formattedRecipient = recipient.includes('@') ? recipient : `${recipient}@s.whatsapp.net`;

                    // Skip validation for group JIDs
                    if (!formattedRecipient.includes('@g.us')) {
                        const [isValidNumber] = await socket.onWhatsApp(formattedRecipient);

                        if (!isValidNumber) {
                            console.log(`Invalid WhatsApp number: ${formattedRecipient}`);
                            failedReason = `Invalid WhatsApp number: ${formattedRecipient}`;
                            status = 'failed';
                            continue; // Skip to the next recipient
                        }
                    }

                    const finalOutput = await generateMessageFromContent(messageObject);
                    await delay(3000); // Add a delay between messages
                    const sentMsg = await socket.sendMessage(formattedRecipient, finalOutput);
                    console.log(`Message sent to ${formattedRecipient}:`, sentMsg);
                    status = 'sent';
                    messageId = sentMsg.key.id;

                } catch (error) {
                    console.error(`Error sending message to ${recipient}:`, error);
                    failedReason = `Error sending message: ${error.message}`;
                    status = 'failed';
                }
            }
        }

        // Update the database with the status and failedReason
        if (messageId) {
            await this.database.runQuery(`
            UPDATE scheduled_messages
            SET status = ?, failedReason = ?
            WHERE id = ?;
        `, [status, failedReason, messageId]);
        }

        return {
            messageId: messageId || '000000000000',
            timestamp: new Date(),
            status
        };
    }


    private getMediaType(url: string): 'image' | 'video' | 'audio' | 'document' {
        const extension = url.split('.').pop()?.toLowerCase();
        switch (extension) {
            case 'jpg':
            case 'jpeg':
            case 'png':
            case 'gif':
                return 'image';
            case 'mp4':
            case 'avi':
            case 'mov':
                return 'video';
            case 'mp3':
            case 'wav':
            case 'ogg':
                return 'audio';
            default:
                return 'document';
        }
    }

    getMimeType(url: string): string {
        const extension = url.split('.').pop()?.toLowerCase();
        switch (extension) {
            case 'jpg':
            case 'jpeg':
                return 'image/jpeg';
            case 'png':
                return 'image/png';
            case 'gif':
                return 'image/gif';
            case 'mp4':
                return 'video/mp4';
            case 'avi':
                return 'video/x-msvideo';
            case 'mov':
                return 'video/quicktime';
            case 'mp3':
                return 'audio/mpeg';
            case 'wav':
                return 'audio/wav';
            case 'ogg':
                return 'audio/ogg';
            case 'pdf':
                return 'application/pdf';
            case 'doc':
                return 'application/msword';
            case 'docx':
                return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            default:
                return 'application/octet-stream'; // Default MIME type for unknown extensions
        }
    }



    isConnected(userId: string): boolean {
        const status = this.connectionStatuses.get(userId);
        return status ? status.isConnected : false;
    }

    getConnectionStatus(userId: string): ConnectionStatus | null {
        return this.connectionStatuses.get(userId) || null;
    }

    async generatePairingCode(userId: string, phoneNumber: string): Promise<string> {
        if (this.isConnected(userId)) {
            throw new Error('User is already connected');
        }

        const parsedNumber = this.validatePhoneNumber(phoneNumber);
        if (!parsedNumber) {
            throw new Error('Invalid phone number');
        }

        await this.initializeConnection(userId);
        const socket = this.connections.get(userId);
        if (!socket) {
            throw new Error('Failed to create connection for pairing');
        }

        try {
            const code = await socket.requestPairingCode(parsedNumber + '@s.whatsapp.net');
            return code;
        } catch (error) {
            console.error(`Failed to generate pairing code for user ${userId}:`, error);
            throw new Error('Failed to generate pairing code');
        }
    }

    onQR(userId: string, callback: (qr: string) => void): void {
        this.qrCallbacks.set(userId, callback);
    }

    getQR(userId: string): string | null {
        return this.qrCodes.get(userId) || null;
    }

    async initializeOrGetQR(userId: string): Promise<string> {
        if (this.isConnected(userId)) {
            throw new Error('User is already connected');
        }

        if (this.qrCodes.has(userId)) {
            return this.qrCodes.get(userId);
        }

        return new Promise((resolve, reject) => {
            this.initializeConnection(userId)
                .then((qrCode) => {
                    this.qrCodes.set(userId, qrCode);
                    resolve(qrCode);
                })
                .catch(reject);
        });
    }

    private async generateQRCode(qr: string): Promise<string> {
        try {
            const qrImage = await qrcode.toDataURL(qr);
            return qrImage; // Return only the Base64 part
        } catch (error) {
            console.error('Failed to generate QR code:', error);
            throw new Error('QR code generation failed');
        }
    }

    private updateConnectionStatus(userId: string, isConnected: boolean): void {
        const currentStatus = this.connectionStatuses.get(userId) || {
            isConnected: false,
            lastConnected: null,
            lastDisconnected: null,
        };

        const newStatus: ConnectionStatus = {
            ...currentStatus,
            isConnected,
            ...(isConnected
                ? { lastConnected: new Date() }
                : { lastDisconnected: new Date() }),
        };

        this.connectionStatuses.set(userId, newStatus);
    }

    private async deleteAuthFolder(userId: string): Promise<void> {
        const userAuthFolder = this.authFolder + '/' + userId;
        if (fs.existsSync(userAuthFolder)) {
            try {
                await fs.promises.rm(userAuthFolder, { recursive: true, force: true });
                console.log(`Auth folder deleted for user: ${userId}`);
            } catch (error) {
                console.error(`Failed to delete auth folder for user ${userId}:`, error);
            }
        }
    }

    private validatePhoneNumber(number: string): string | null {
        try {
            const parsedNumber = phoneNumber.parsePhoneNumber(number.toString());
            if (parsedNumber.isValid()) {
                return parsedNumber.format('E.164');
            }
        } catch (error) {
            console.error('Phone number validation error:', error);
        }
        return null;
    }


    async getUserDetails(userId: string): Promise<{ name: string, number: string, avatar: string } | string> {
        try {
            if (!userId) {
                throw new Error('please provide a user ID');
            }
            // Fetch user data from the database
            const userData = await this.database.getValues('user_data', ['name', 'number', 'avatar', 'isLoggedIn'], { userId });

            // Check if user data exists
            if (userData.length === 0) {
                // If no user data is found, throw a custom error
                throw new Error(`User with userId ${userId} not found`);
            }

            // Return the user details
            return userData[0];
        } catch (error) {
            // Handle errors gracefully
            console.error(`Error fetching user details for userId ${userId}:`, error);

            // If it's a custom error, re-throw it to be handled by the caller
            if (error.message.includes('User with userId')) {
                throw error;
            }

            // For other errors, throw a generic error
            throw new Error('Failed to fetch user details');
        }
    }

    async getSavedGroups(userId: string): Promise<newGroupMetaData[]> {
        if (!userId) {
            throw new Error('UserId is required');
        }
        const userGroups = this.waUserGroups.get(userId);

        if (!userGroups) {
            throw new Error(`No saved groups found for user ${userId}`);
        }
        return Object.values(userGroups).map(group => ({
            ...group,
            imageUrl: group.imageUrl || null
        }));
    }

    private async handleGroupsUpsert(userId: string, groups: GroupMetadata[]): Promise<void> {
        const userGroups = this.waUserGroups.get(userId) || {};
        groups.forEach(group => {
            userGroups[group.id] = {
                ...group,
                pendingPfpFetch: true // Add this flag
            };
        });

        this.waUserGroups.set(userId, userGroups);
        console.log(`[WhatsApp] Updated groups for user ${userId}`);
        // Schedule profile picture fetching
        this.schedulePfpFetching(userId);
    }

    private async schedulePfpFetching(userId: string): Promise<void> {
        const userGroups = this.waUserGroups.get(userId) || {};

        for (const [groupId, group] of Object.entries(userGroups)) {
            // Skip to next group if imageUrl already exists
            if (group.imageUrl) {
                console.log(`[WhatsApp] Skipping group ${groupId}, image URL already exists`);
                continue;
            }

            // Random delay between 30-60 seconds
            const delay = Math.floor(Math.random() * (60000 - 30000 + 1) + 30000);
            await new Promise(resolve => setTimeout(resolve, delay));

            try {

                const socket = this.connections.get(userId);
                const conn = this.connectionStatuses.get(userId);

                if ((socket && !conn.isConnected) || !socket) {
                    console.log(`[WhatsApp] No active connection for user ${userId}`);
                    return;
                }

                let pfpUrl;
                if (group.isCommunity) {
                    group.imageUrl = "https://cdn.pixabay.com/photo/2021/07/02/04/48/user-6380868_640.png";
                    group.pendingPfpFetch = false;
                    console.log(`[WhatsApp] Fetched profile picture for group ${groupId} ${group.isCommunity ? 'Preview Image!' : 'HD Image!'}`);
                    continue;
                } else {
                    pfpUrl = await socket.profilePictureUrl(groupId, 'image');
                }
                console.log(`[WhatsApp] Fetched profile picture for group ${groupId} ${group.isCommunity ? 'Preview Image!' : 'HD Image!'}`);
                group.imageUrl = pfpUrl;
                group.pendingPfpFetch = false;
            } catch (error) {
                if (error.message.toLowerCase() === "item-not-found" || error.message.toLowerCase() === "not-authorized") {
                    group.imageUrl = "https://cdn.pixabay.com/photo/2021/07/02/04/48/user-6380868_640.png";
                    group.pendingPfpFetch = false;
                    continue;
                }
                console.error(`[WhatsApp] Failed to fetch profile picture for group ${groupId}:`, error);
            }
        }

        this.waUserGroups.set(userId, userGroups);
        console.log(`[WhatsApp] Completed profile picture fetching for user ${userId}`);
    }



    private async handleGroupsUpdate(userId: string, updates: Partial<GroupMetadata>[]): Promise<void> {
        const userGroups = this.waUserGroups.get(userId) || {};
        updates.forEach(update => {
            if (update.id && userGroups[update.id]) {
                userGroups[update.id] = { ...userGroups[update.id], ...update };
            }
        });
        this.waUserGroups.set(userId, userGroups);
        console.log(`[WhatsApp] Updated group metadata for user ${userId}`);
    }

    private async handleGroupParticipantsUpdate(
        userId: string,
        update: { id: string; participants: string[]; action: string },
        socket: WASocket
    ): Promise<void> {
        const userGroups = this.waUserGroups.get(userId) || {};
        console.log(`[WhatsApp] Group update received for ${update.id}: ${update.action}`);

        if (!userGroups[update.id]) {
            console.warn(`[WhatsApp] Attempted to update non-existent group: ${update.id}`);
            return;
        }

        const normalizeJid = (jid: string): string =>
            jid.includes(':') ? jid.split(':')[0] + '@s.whatsapp.net' : jid;

        const botJid = normalizeJid(socket.user.id);

        switch (update.action) {
            case 'add':
                userGroups[update.id].participants.push(
                    ...update.participants.map(jid => ({
                        id: normalizeJid(jid),
                        isAdmin: false,
                        isSuperAdmin: false,
                    }))
                );
                break;
            case 'remove':
                const removedParticipants = new Set(update.participants.map(normalizeJid));
                if (removedParticipants.has(botJid)) {
                    delete userGroups[update.id];
                    console.log(`[WhatsApp] Bot was removed from group ${update.id}. Group data deleted.`);
                } else {
                    userGroups[update.id].participants = userGroups[update.id].participants.filter(
                        p => !removedParticipants.has(normalizeJid(p.id))
                    );
                    console.log(`[WhatsApp] Removed ${removedParticipants.size} participant(s) from group ${update.id}`);
                }
                break;
        }

        this.waUserGroups.set(userId, userGroups);
        console.log(`[WhatsApp] Updated group ${update.id} for user ${userId}`);
    }


    private async handleIncomingMessages(userId: string, messages: proto.IWebMessageInfo[]) {
        for (const message of messages) {
            if (message.key && message.key.remoteJid) {
                const jid = message.key.remoteJid;

                try {
                    const rows = await this.database.getValues('chats', ['*'], { fromJid: jid });

                    if (rows.length > 0) {
                        rows.forEach(async (row) => {
                            console.log(row)
                            console.log(`Related sender found: ${row.fromJid}`);
                            await this.forwardMessage(message, row.toJid, userId);
                            // You can add more logic here to handle the matched rows
                        });
                    }
                } catch (error) {
                    console.error('Error handling incoming message:', error);
                }
            }
        }
    }

    async forwardMessage(m: WAMessage, toId: string, userId: string) {
        let tempFilePath: string | null = null;
        let media: any;
        let buffer: Buffer | null = null;

        try {
            await this.initializeConnection(userId);
            const socket: WASocket | undefined = this.connections.get(userId);
            if (!socket) {
                throw new Error('Failed to create connection for pairing');
            }

            const forwardMessage = await generateForwardMessageContent(m, false);
            console.log('Forward message content:', forwardMessage);

            if (forwardMessage.extendedTextMessage?.text) {
                media = { text: forwardMessage.extendedTextMessage.text };
            } else if (forwardMessage.conversation) {
                media = { text: forwardMessage.conversation };
            } else if (m.message) {
                const messageType = Object.keys(m.message)[0] as keyof typeof m.message;
                const messageContent = m.message[messageType] as any;

                // Skip poll-related messages
                if (['pollCreationMessage', 'pollCreationMessageV3', 'pollUpdateMessage'].includes(messageType)) {
                    console.log(`Skipping poll-related message: ${messageType}`);
                    return;
                }

                switch (messageType) {
                    case 'imageMessage':
                    case 'videoMessage':
                    case 'audioMessage':
                    case 'stickerMessage':
                    case 'documentMessage':
                    case 'documentWithCaptionMessage':
                    case 'senderKeyDistributionMessage':
                        try {
                            if (messageType === "senderKeyDistributionMessage" && m.message.imageMessage) {
                                console.log('Hahhahahahah')

                            }

                            buffer = await downloadMediaMessage(
                                m,
                                'buffer',
                                {},
                                {
                                    logger: console,
                                    reuploadRequest: socket.updateMediaMessage
                                }
                            ) as Buffer;

                            tempFilePath = `./temp_${Date.now()}.bin`;
                            fs.writeFileSync(tempFilePath, buffer);

                            media = {
                                [messageType.replace('Message', '')]: fs.readFileSync(tempFilePath)
                            };

                            if (messageType === 'audioMessage') {
                                media.ptt = messageContent.ptt;
                            }

                            if (messageType.includes('document')) {
                                media.mimetype = messageContent.mimetype || messageContent.message?.documentMessage?.mimetype;
                                media.fileName = messageContent.fileName || messageContent.message?.documentMessage?.fileName;
                            }
                        } catch (err) {
                            console.error("Error downloading media:", err);
                            return;
                        }
                        break;
                    case 'contactMessage':
                        media = { contacts: { contacts: [{ vcard: messageContent.vcard }] } };
                        break;
                    case 'locationMessage':
                        media = {
                            location: {
                                degreesLatitude: messageContent.degreesLatitude,
                                degreesLongitude: messageContent.degreesLongitude
                            }
                        };
                        break;
                    case 'liveLocationMessage':
                        media = {
                            liveLocation: {
                                degreesLatitude: messageContent.degreesLatitude,
                                degreesLongitude: messageContent.degreesLongitude,
                                accuracyInMeters: messageContent.accuracyInMeters,
                                speedInMps: messageContent.speedInMps,
                                degreesClockwiseFromMagneticNorth: messageContent.degreesClockwiseFromMagneticNorth,
                                caption: messageContent.caption,
                                sequenceNumber: messageContent.sequenceNumber,
                                timeOffset: messageContent.timeOffset,
                                jpegThumbnail: messageContent.jpegThumbnail
                            }
                        };
                        break;
                    default:
                        console.log(`Unsupported message type: ${messageType}`);
                        return;
                }

                if (messageContent.caption || (messageContent.message && messageContent.message.documentMessage && messageContent.message.documentMessage.caption)) {
                    media.caption = messageContent.caption || messageContent.message.documentMessage.caption;
                }
            }

            if (media) {
                console.log(media)
                await socket.sendMessage(toId, media);
                console.log("Message sent successfully");
            } else {
                console.log("No supported content found in the message");
            }

        } catch (error) {
            console.error("Error forwarding message:", error);
        } finally {
            if (buffer) {
                buffer = null;
            }
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
                console.log("Temporary file deleted");
            }
        }
    }

}