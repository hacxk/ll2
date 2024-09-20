import { Controller, Post, Get, Body, Param, HttpException, HttpStatus, Sse, MessageEvent, BadRequestException } from '@nestjs/common';
import { WhatsAppService } from './whatsapp/whatsapp.service';
import { Observable } from 'rxjs';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiParam } from '@nestjs/swagger';
import { CreateConnectionDto, ErrorResponseDto, GeneratePairingCodeDto, SendMessageDto, SendMessageResponseDto } from './dto/apiDto';
import { EventEmitter2 } from '@nestjs/event-emitter';

interface CreateConnectionDtoType {
  userId: string;
  pairingCode?: string;
}

interface GeneratePairingCodeDtoType {
  userId: string;
  phoneNumber: string;
}

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsAppController {
  constructor(
    private readonly whatsAppService: WhatsAppService,
    private eventEmitter: EventEmitter2
  ) { }

  @Post('connect')
  @ApiOperation({ summary: 'Create a new WhatsApp connection' })
  @ApiBody({ type: CreateConnectionDto })
  @ApiResponse({ status: 201, description: 'Connection initiated successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createConnection(@Body() createConnectionDto: CreateConnectionDtoType): Promise<{ message: string }> {
    try {
      await this.whatsAppService.createConnection(createConnectionDto.userId);
      return { message: 'Connection initiated successfully' };
    } catch (error) {
      throw new HttpException('Failed to create connection: ' + error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('close-connection/:userId')
  @ApiOperation({ summary: 'Close a WhatsApp connection for a user' })
  @ApiParam({ name: 'userId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Connection closed successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async closeConnection(@Param('userId') userId: string): Promise<{ message: string }> {
    try {
      await this.whatsAppService.closeConnection(userId);
      return { message: 'Connection closed successfully' };
    } catch (error) {
      throw new HttpException('Failed to close connection: ' + error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }


  @Post('logout/:userId')
  @ApiOperation({ summary: 'Logout a user from WhatsApp' })
  @ApiParam({ name: 'userId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async logout(@Param('userId') userId: string): Promise<{ message: string }> {
    try {
      await this.whatsAppService.logout(userId);
      return { message: 'Logged out successfully' };
    } catch (error) {
      throw new HttpException('Failed to logout: ' + error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }



  @Get('qr/:userId')
  @ApiOperation({ summary: 'Get QR code for WhatsApp Web' })
  @ApiParam({ name: 'userId', type: 'string' })
  @ApiResponse({ status: 200, description: 'QR code retrieved successfully' })
  async getQR(@Param('userId') userId: string): Promise<{ qr: string | null }> {
    const qr = this.whatsAppService.getQR(userId);
    return { qr };
  }

  @Get('status/:userId')
  @ApiOperation({ summary: 'Get connection status for a user' })
  @ApiParam({ name: 'userId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Connection status retrieved successfully' })
  async getConnectionStatus(@Param('userId') userId: string): Promise<{ status: any }> {
    const status = this.whatsAppService.getConnectionStatus(userId);
    return { status };
  }

  @Sse('qr-stream/:userId')
  @ApiOperation({ summary: 'Stream QR code updates for a user' })
  @ApiParam({ name: 'userId', type: 'string' })
  @ApiResponse({ status: 200, description: 'QR code stream established' })
  @ApiResponse({ status: 400, description: 'Bad request or user already connected' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async qrStream(@Param('userId') userId: string): Promise<Observable<MessageEvent>> {
    return new Observable<MessageEvent>(observer => {
      const eventHandler = (qrCode: string) => {
        observer.next({
          data: JSON.stringify({
            qrCode,
            timestamp: new Date().toISOString(),
          }),
        });
      };

      this.eventEmitter.on(`qr.${userId}`, eventHandler);

      this.whatsAppService.initializeOrGetQR(userId)
        .then(() => {
          console.log(`QR stream initialized for user ${userId}`);
        })
        .catch(error => {
          console.error(`Error initializing QR stream for user ${userId}:`, error);
          observer.error(new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR));
        });

      return () => {
        this.eventEmitter.removeListener(`qr.${userId}`, eventHandler);
        console.log(`QR stream closed for user ${userId}`);
      };
    });
  }



  @Get('is-connected/:userId')
  @ApiOperation({ summary: 'Check if a user is connected' })
  @ApiParam({ name: 'userId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Connection status retrieved successfully' })
  isConnected(@Param('userId') userId: string): { connected: boolean } {
    const connected = this.whatsAppService.isConnected(userId);
    return { connected };
  }

  @Post('generate-pairing-code')
  @ApiOperation({ summary: 'Generate a pairing code for WhatsApp Web' })
  @ApiBody({ type: GeneratePairingCodeDto })
  @ApiResponse({ status: 200, description: 'Pairing code generated successfully' })
  @ApiResponse({ status: 400, description: 'User already connected' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async generatePairingCode(@Body() generatePairingCodeDto: GeneratePairingCodeDtoType): Promise<{ pairingCode: string }> {
    try {
      if (this.whatsAppService.isConnected(generatePairingCodeDto.userId)) {
        throw new HttpException('User is already connected', HttpStatus.BAD_REQUEST);
      }
      const pairingCode = await this.whatsAppService.generatePairingCode(
        generatePairingCodeDto.userId,
        generatePairingCodeDto.phoneNumber
      );
      return { pairingCode };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }


  @Get('health')
  @ApiOperation({ summary: 'Check the health status of the WhatsApp service' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 500, description: 'Service is unhealthy' })
  async healthCheck(): Promise<{ status: string, message: string }> {
    try {
      // Perform any necessary checks here
      // For example, you could check database connectivity, external service health, etc.

      // For now, we'll just return a simple "OK" status
      return {
        status: 'OK',
        message: 'WhatsApp service is running and healthy'
      };
    } catch (error) {
      throw new HttpException('Service is unhealthy: ' + error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('/user/:userId')
  async getUserDetails(@Param('userId') userId: string) {
    try {
      const userDetails = await this.whatsAppService.getUserDetails(userId);
      return userDetails;
    } catch (error) {
      // Handle the error appropriately, e.g., return an error response
      return { error: error.message };
    }
  }

  @Get('groups/:userId')
  async getSavedGroups(@Param('userId') userId: string): Promise<{ success: boolean, groups: any[] }> {
    try {
      const groups = await this.whatsAppService.getSavedGroups(userId);
      return { success: true, groups };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.BAD_REQUEST,
        error: error.message,
      }, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('send-message')
  @ApiOperation({ summary: 'Send a message via WhatsApp' })
  @ApiBody({ type: SendMessageDto })
  @ApiResponse({ status: 200, type: SendMessageResponseDto, description: 'Message sent successfully' })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Bad request' })
  @ApiResponse({ status: 500, type: ErrorResponseDto, description: 'Internal server error' })
  async sendMessage(@Body() sendMessageDto: SendMessageDto): Promise<SendMessageResponseDto> {
    try {
      console.log(sendMessageDto)
      // Validate the input
      this.validateSendMessageDto(sendMessageDto);

      // Send the message
      const result = await this.whatsAppService.sendMessage(sendMessageDto);

      return {
        success: true,
        messageId: result.messageId,
        timestamp: result.timestamp
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.log(error)
      throw new HttpException(
        'Failed to send message: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private validateSendMessageDto(dto: SendMessageDto) {
    if (!dto.userId) {
      throw new BadRequestException('User ID is required');
    }
    if (!dto.recipients || dto.recipients.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }
    if (!dto.content || !dto.type) {
      throw new BadRequestException('Message content and type are required');
    }
    // Add more specific validations based on message type
    switch (dto.type) {
      case 'text':
        if (!dto.content.text) {
          throw new BadRequestException('Text content is required for text messages');
        }
        break;
      case 'poll':
        if (!dto.content.poll || !dto.content.poll.name || !dto.content.poll.options || dto.content.poll.options.length < 2) {
          throw new BadRequestException('Poll name and at least two options are required for poll messages');
        }
        break;
    }
  }

}