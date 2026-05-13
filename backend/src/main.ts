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
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
    'https://nexus.technoedge.in',            // production frontend (Vercel)
    'https://www.nexus.technoedge.in',
    process.env.FRONTEND_URL,                 // override via env (Railway / custom)
  ].filter(Boolean) as string[];

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
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
