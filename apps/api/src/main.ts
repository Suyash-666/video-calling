import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'] });
  await app.listen(process.env.PORT ?? 4000);
  console.log('ConnectCall signaling server running on port 4000');
}
bootstrap();
