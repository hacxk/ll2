import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SqliteHelper } from './sqlite.helper';
import { v4 as uuidv4 } from 'uuid';

export interface ChatData {
    userID: string;
    fromJid: string;
    toJid: string;
    fromJidName: string;
    toJidName: string;
    timestamp: string;
}

export interface ChatDataWithId extends ChatData {
    id: string;

}

@Injectable()
export class ChatService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ChatService.name);
    private readonly dbPath = './database/chat_database.sqlite';

    constructor(private readonly sqliteHelper: SqliteHelper) { }

    async onModuleInit() {
        await this.sqliteHelper.connect(this.dbPath);
        await this.initializeDatabase();
    }

    async onModuleDestroy() {
        await this.sqliteHelper.close();
    }

    private async initializeDatabase() {
        const createTableQuery = `
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        userID TEXT,
        fromJid TEXT,
        toJid TEXT,
        fromjidName TEXT,
        toJidName TEXT,
        timestamp TEXT
      )
    `;
        await this.sqliteHelper.runQuery(createTableQuery);
    }

    async saveChat(chatData: ChatData[]): Promise<ChatDataWithId[]> {
        const savedChats: ChatDataWithId[] = [];

        for (const chat of chatData) {
            // Check if a similar entry already exists
            const existingChat = await this.sqliteHelper.getValues('chats', ['id'], {
                userID: chat.userID,
                fromJid: chat.fromJid,
                toJid: chat.toJid
            });

            if (existingChat.length > 0) {
                this.logger.log(`Chat already exists: ${existingChat[0].id}`);
                continue; // Skip this entry
            }

            // Check if the reverse entry exists (fromJid and toJid swapped)
            const reverseChat = await this.sqliteHelper.getValues('chats', ['id'], {
                userID: chat.userID,
                fromJid: chat.toJid,
                toJid: chat.fromJid
            });

            if (reverseChat.length > 0) {
                this.logger.log(`Reverse chat already exists: ${reverseChat[0].id}`);
                continue; // Skip this entry
            }

            const id = uuidv4();
            const chatDataWithId: ChatDataWithId = { ...chat, id };

            const query = `
            INSERT INTO chats (id, userID, fromJid, toJid, fromJidName, toJidName, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
            const params = [
                id,
                chatDataWithId.userID,
                chatDataWithId.fromJid,
                chatDataWithId.toJid,
                chatDataWithId.fromJidName || '',
                chatDataWithId.toJidName || '',
                chatDataWithId.timestamp,
            ];

            try {
                await this.sqliteHelper.runQuery(query, params);
                this.logger.log(`Chat saved successfully: ${id}`);
                savedChats.push(chatDataWithId);
            } catch (error) {
                this.logger.error(`Error saving chat: ${error.message}`);
            }
        }

        return savedChats;
    }


    async readChat(userID?: string, id?: string): Promise<ChatDataWithId[]> {
        if (!userID && !id) {
            throw new Error('Either userID or id must be provided');
        }

        let query: string;
        let params: (string | undefined)[];

        if (userID && id) {
            query = 'SELECT * FROM chats WHERE userID = ? AND id = ?';
            params = [userID, id];
        } else if (userID) {
            query = 'SELECT * FROM chats WHERE userID = ?';
            params = [userID];
        } else {
            query = 'SELECT * FROM chats WHERE id = ?';
            params = [id];
        }

        const chats = await this.sqliteHelper.getValues(query, params);

        if (chats.length === 0) {
            if (userID && id) {
                this.logger.warn(`Chat not found for user ${userID} and id ${id}`);
            } else if (userID) {
                this.logger.warn(`No chats found for user ${userID}`);
            } else {
                this.logger.warn(`Chat not found with id ${id}`);
            }
        } else {
            this.logger.log(`Found ${chats.length} chat(s)`);
        }

        return chats;
    }

    async listUserChats(userID: string): Promise<ChatDataWithId[]> {
        const query = 'SELECT * FROM chats WHERE userID = ? ORDER BY timestamp DESC';
        return await this.sqliteHelper.getAll<ChatDataWithId>(query, [userID]);
    }

    async deleteChat(userID?: string, id?: string): Promise<boolean> {
        if (!userID && !id) {
            throw new Error('Either userID or id must be provided');
        }

        let query: string;
        let params: (string | undefined)[];

        if (userID && id) {
            query = 'DELETE FROM chats WHERE userID = ? AND id = ?';
            params = [userID, id];
        } else if (id) {
            query = 'DELETE FROM chats WHERE id = ?';
            params = [id];
        } else {
            throw new Error('Invalid parameters for deleteChat');
        }

        try {
            const result = await this.sqliteHelper.runQuery(query, params);

            if (result.changes > 0) {
                this.logger.log(`Chat deleted successfully: ${id ? `id ${id}` : `user ${userID}`}`);
                return true;
            } else {
                this.logger.warn(`No chat found to delete: ${id ? `id ${id}` : `user ${userID}`}`);
                return false;
            }
        } catch (error) {
            this.logger.error(`Error deleting chat: ${error.message}`);
            throw error;
        }
    }

}