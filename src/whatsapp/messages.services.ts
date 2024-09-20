import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SqliteHelper } from "./sqlite.helper";

@Injectable()
export class MessagesService {
    constructor(private database: SqliteHelper) { }

    async getScheduledMessages(userId: string): Promise<any[]> {
        if (!userId) {
            throw new BadRequestException('User ID is required');
        }

        try {
            const messages = await this.database.getValues('scheduled_messages', ['*'], { userId });
            if (messages.length === 0) {
                return []; // Return an empty array if no messages found
            }

            // Parse JSON strings
            return messages.map(message => ({
                ...message,
                content: JSON.parse(message.content),
                recipients: JSON.parse(message.recipients)
            }));
        } catch (error) {
            console.error(`Error fetching scheduled messages for user ${userId}:`, error);
            throw new Error('Failed to fetch scheduled messages');
        }
    }

    async deleteScheduledMessage(id: string): Promise<void> {
        if (!id) {
            throw new BadRequestException('Message ID is required');
        }

        try {
            const result = await this.database.runQuery('DELETE FROM scheduled_messages WHERE id = ?', [id]);
            if (result.changes === 0) {
                throw new NotFoundException(`Scheduled message with id ${id} not found`);
            }
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error(`Error deleting scheduled message with id ${id}:`, error);
            throw new Error('Failed to delete scheduled message');
        }
    }
}
