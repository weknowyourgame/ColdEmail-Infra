export interface Env {
  CF_API_TOKEN: string;
  KV: KVNamespace;
  JWT_SECRET: string;
  BROWSER: Fetcher;
}

export interface DomainSetup {
  domain: string;
  redirectTo: string;
  reportEmail: string;
}

export interface CloudflareResponse {
  success: boolean;
  errors: any[];
  result: any;
}

export interface AutomationConfig {
  apiKey: string;
  csvData: string;
  loginUrl: string;
  maxRetries?: number;
}

export interface EmailCredential {
  email: string;
  password: string;
}

export interface AutomationResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  skippedCount: number;
  details: {
    email: string;
    status: 'success' | 'failed' | 'skipped';
    error?: string;
  }[];
}

export interface SmartleadResponse {
  success: boolean;
  data: {
    from_email: string;
    // ... other fields
  }[];
}

export interface WarmupConfig {
  apiKey: string;
  totalWarmupPerDay?: number;
  dailyRampup?: number;
  replyRatePercentage?: number;
  warmupKeyId?: string;
}

export interface WarmupResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  details: {
    id: string;
    status: 'success' | 'failed';
    error?: string;
  }[];
}

export interface ReconnectResult {
  success: boolean;
  message: string;
  timestamp: number;
}