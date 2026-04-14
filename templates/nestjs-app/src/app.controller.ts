import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getRoot(): { name: string; version: string } {
    return {
      name: process.env.PROJECT_NAME ?? 'nestjs-app',
      version: '1.0.0',
    };
  }

  @Get('health')
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
