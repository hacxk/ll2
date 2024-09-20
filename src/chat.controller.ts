import { Controller, Post, Get, Delete, Param, Body } from '@nestjs/common';
import { ChatData, ChatService } from './whatsapp/StoreManagerService';

@Controller('chats')
export class ChatController {
    constructor(private readonly fileManagerService: ChatService) { }

    @Post()
    async saveChat(@Body() chatData: ChatData[]) {
        const savedChat = await this.fileManagerService.saveChat(chatData);
        return { message: 'Chat saved successfully', chat: savedChat };
    }

    @Get(':userId/:chatId')
    async getChat(@Param('userId') userId: string, @Param('chatId') chatId: string) {
        const chat = await this.fileManagerService.readChat(userId, chatId);
        if (!chat) {
            return { message: 'Chat not found' };
        }
        return { chat };
    }

    @Get(':userId')
    async listChats(@Param('userId') userId: string) {
        const chats = await this.fileManagerService.listUserChats(userId);
        return { chats };
    }

    @Delete(':userId/:chatId')
    async deleteChat(@Param('userId') userId: string, @Param('chatId') chatId: string) {
        const deleted = await this.fileManagerService.deleteChat(userId, chatId);
        if (deleted) {
            return { message: 'Chat deleted successfully' };
        }
        return { message: 'Chat not found or could not be deleted' };
    }

    @Delete(':chatId')
    async deleteChatById(@Param('chatId') chatId: string) {
        const deleted = await this.fileManagerService.deleteChat(undefined, chatId);
        if (deleted) {
            return { message: 'Chat deleted successfully' };
        }
        return { message: 'Chat not found or could not be deleted' };
    }
}
