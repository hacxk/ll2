import { Controller, Delete, Get, Param } from '@nestjs/common';
import { MessagesService } from './whatsapp/messages.services';

@Controller('messages')
export class MessagesController {
    constructor(private readonly whatsappService: MessagesService) { }

    @Get('scheduled/:userId')
    async getScheduledMessages(@Param('userId') userId: string) {
        try {
            const scheduledMessages = await this.whatsappService.getScheduledMessages(userId);
            return { success: true, data: scheduledMessages };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    @Delete('scheduled/:id')
    async deleteScheduledMessage(@Param('id') id: string) {
        try {
            await this.whatsappService.deleteScheduledMessage(id);
            return { success: true, message: 'Message deleted successfully' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }
}