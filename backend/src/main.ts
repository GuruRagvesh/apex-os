import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const isProd = process.env.NODE_ENV === 'production';

  // ── Security ──────────────────────────────────────────────────────────────
  app.use(helmet({
    // Allow inline scripts for Swagger UI in non-production
    contentSecurityPolicy: isProd ? undefined : false,
  }));

  // ── Compression ───────────────────────────────────────────────────────────
  app.use(compression());

  // ── Global prefix ─────────────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── WebSocket ─────────────────────────────────────────────────────────────
  app.useWebSocketAdapter(new IoAdapter(app));

  // ── CORS ──────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://apex-os.vercel.app',
      'https://apex-os-frontend.vercel.app',
      'https://apex-os-frontend-git-main-guru-ragvesh-thanumoorthys-projects.vercel.app',
      process.env.FRONTEND_URL,
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Validation ────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // ── Swagger (disable in production) ───────────────────────────────────────
  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('Nexus API')
      .setDescription('TechnoEdge Internal Business Management API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  const port = process.env.PORT || 3001;
  await app.listen(port);

  const baseUrl = isProd
    ? `https://nexus-api.up.railway.app`
    : `http://localhost:${port}`;

  console.log(`\n🚀 Nexus API  →  ${baseUrl}/api`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  if (!isProd) {
    console.log(`📚 Swagger docs → http://localhost:${port}/api/docs`);
  }
  console.log(`❤️  Health check → ${baseUrl}/api/health\n`);
}

bootstrap();
