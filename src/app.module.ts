import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { WhatsAppController } from './app.controller';
import { AppService } from './app.service';
import { WhatsAppService } from './whatsapp/whatsapp.service';
import { ChatService } from './whatsapp/StoreManagerService';
import { ChatController } from './chat.controller';
import { SqliteHelper } from './whatsapp/sqlite.helper';
import { MessagesController } from './message.controller';
import { MessagesService } from './whatsapp/messages.services';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [EventEmitterModule.forRoot(), ScheduleModule.forRoot()],
  controllers: [WhatsAppController, ChatController, MessagesController],
  providers: [AppService, WhatsAppService, ChatService, SqliteHelper, MessagesService],
  exports: [SqliteHelper]
})
export class AppModule { }
