interface WarmupConfig {
  apiKey: string;
  totalWarmupPerDay?: number;
  dailyRampup?: number;
  replyRatePercentage?: number;
  warmupKeyId?: string;
}

interface WarmupResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  details: {
    id: string;
    status: 'success' | 'failed';
    error?: string;
  }[];
}

interface ReconnectResult {
  success: boolean;
  message: string;
  timestamp: number;
}

export class WarmupService {
  private readonly baseUrl = "https://server.smartlead.ai/api/v1";
  
  constructor(private config: WarmupConfig) {}

  async processWarmup(): Promise<WarmupResult> {
    try {
      // Initialize result object
      const result: WarmupResult = {
        success: true,
        processedCount: 0,
        failedCount: 0,
        details: []
      };

      // Fetch all email accounts
      const emailAccounts = await this.fetchEmailAccounts();
      
      // Process each account
      for (const account of emailAccounts) {
        try {
          await this.enableWarmup(account.id);
          
          result.processedCount++;
          result.details.push({
            id: account.id,
            status: 'success'
          });
        } catch (error) {
          result.failedCount++;
          result.details.push({
            id: account.id,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      return result;

    } catch (error) {
      throw new Error(`Warmup process failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async fetchEmailAccounts(): Promise<Array<{ id: string }>> {
    const accounts: Array<{ id: string }> = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const response = await fetch(
        `${this.baseUrl}/email-accounts?offset=${offset}&limit=${limit}`, 
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch accounts: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data || data.length === 0) break;
      
      accounts.push(...data);
      
      if (data.length < limit) break;
      
      offset += limit;
    }

    return accounts;
  }

  private async enableWarmup(accountId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/email-accounts/${accountId}/warmup`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          warmup_enabled: true,
          total_warmup_per_day: this.config.totalWarmupPerDay || 50,
          daily_rampup: this.config.dailyRampup || 50,
          reply_rate_percentage: this.config.replyRatePercentage || 100,
          warmup_key_id: this.config.warmupKeyId || 'default'
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to enable warmup for account ${accountId}: ${response.statusText}`);
    }
  }

  async reconnectFailedAccounts(): Promise<ReconnectResult> {
    try {
      const response = await fetch(
        `${this.baseUrl}/email-accounts/reconnect-failed-email-accounts`, 
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to reconnect accounts: ${response.statusText}`);
      }

      const data = await response.json();
      
      return {
        success: data.ok === true,
        message: data.message,
        timestamp: Date.now()
      };

    } catch (error) {
      throw new Error(`Failed to reconnect accounts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
} 