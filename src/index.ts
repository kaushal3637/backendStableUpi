import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { config } from './services/config';
import paymentRoutes from './routes/payment';
import delegationRoutes from './routes/delegation';
import phonepeRoutes from './routes/phonepe';
import transactionRoutes from './routes/transactions';
import bundlerRoutes from './routes/bundler';
import paymasterRoutes from './routes/paymaster';
import {
  securityHeaders,
  createRateLimiter,
  requestLogger,
  corsOptions
} from './middleware/security';

const app = express();

// Security middleware
app.use(securityHeaders);
app.use(createRateLimiter());

// CORS configuration
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLogger);

// Health check endpoint
app.get('/health', (req: express.Request, res: express.Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv
  });
});

// IP address endpoint
app.get('/ip', (req: express.Request, res: express.Response) => {
  try {
    // Get client IP address
    const clientIP = req.ip || 
                    req.connection.remoteAddress || 
                    req.socket.remoteAddress || 
                    req.headers['x-forwarded-for']?.toString().split(',')[0] ||
                    'unknown';
    
    res.status(200).json({
      success: true,
      server: {
        port: config.port,
        environment: config.nodeEnv,
        hostname: req.hostname || 'localhost'
      },
      client: {
        ip: clientIP,
        userAgent: req.headers['user-agent'] || 'unknown'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting IP information:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get IP information'
    });
  }
});

// API routes
app.use('/api/payments', paymentRoutes);
app.use('/api', delegationRoutes);
app.use('/api/phonepe', phonepeRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api', bundlerRoutes);
app.use('/api', paymasterRoutes);

// Health check for payout service
app.get('/api/payouts/health', async (req: express.Request, res: express.Response) => {
  try {
    // Simple health check - in production you'd check PhonePe API connectivity
    res.status(200).json({
      success: true,
      status: 'healthy',
      service: 'INR Payout Service',
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Payout service health check failed'
    });
  }
});

// 404 handler
app.use('*', (req: express.Request, res: express.Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Global error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', error);

  // Handle CORS errors
  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: 'CORS policy violation'
    });
  }

  // Handle validation errors
  if (error.isJoi) {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: error.details
    });
  }

  // Handle other errors
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
const server = app.listen(config.port, () => {
  console.log(`🚀 Backend server started on port ${config.port}`);
  console.log(`📝 Environment: ${config.nodeEnv}`);
  console.log(`🔗 Health check: http://localhost:${config.port}/health`);
  console.log(`🌐 IP endpoint: http://localhost:${config.port}/ip`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

export default app;
