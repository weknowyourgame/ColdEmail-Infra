import { AutomationConfig, AutomationResult, EmailCredential, Env } from "../../types";
import puppeteer from "@cloudflare/puppeteer";

export class AutomationService {
  private readonly maxRetries: number;
  private readonly baseUrl = "https://server.smartlead.ai/api/v1";

  constructor(
    private config: AutomationConfig,
    private env: Env
  ) {
    this.maxRetries = config.maxRetries || 3;
  }

  async processAutomation(): Promise<AutomationResult> {
    let browser;
    try {
      // Create request ID for tracking
      const requestId = crypto.randomUUID();
      
      // Log start of automation
      await this.env.KV.put(`automation:start:${requestId}`, JSON.stringify({
        timestamp: Date.now(),
        loginUrl: this.config.loginUrl,
        csvSize: this.config.csvData.split('\n').length - 1
      }));

      // Fetch existing emails
      const existingEmails = await this.fetchExistingEmails();
      
      // Parse CSV data
      const credentials = this.parseCSV(this.config.csvData);
      
      // Initialize browser with improved options
      browser = await puppeteer.launch(this.env.BROWSER, {
        headless: true,
        defaultViewport: { width: 1280, height: 720 },
        timeout: 30000
      });
      
      // Initialize result object
      const result: AutomationResult = {
        success: true,
        processedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        details: []
      };

      // Process each credential
      for (const cred of credentials) {
        let page;
        try {
          // Skip if email already exists
          if (existingEmails.includes(cred.email)) {
            result.skippedCount++;
            result.details.push({
              email: cred.email,
              status: 'skipped'
            });
            continue;
          }

          // Log attempt
          await this.logAutomation(cred.email, 'attempt');

          // Process login
          page = await browser.newPage();
          await this.processLogin(page, cred);
          
          result.processedCount++;
          result.details.push({
            email: cred.email,
            status: 'success'
          });

          // Log successful automation
          await this.logAutomation(cred.email, 'success');

        } catch (error) {
          result.failedCount++;
          result.details.push({
            email: cred.email,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error'
          });

          // Log failed automation
          await this.logAutomation(cred.email, 'failed', error);
        } finally {
          if (page) await page.close();
        }

        // Add delay between attempts
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Close browser
      await browser.close();

      // Log completion
      await this.env.KV.put(`automation:complete:${requestId}`, JSON.stringify({
        timestamp: Date.now(),
        result
      }));

      return result;

    } catch (error) {
      throw new Error(`Automation process failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      if (browser) await browser.close();
    }
  }

  private async fetchExistingEmails(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/email-accounts`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch existing emails: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data.map(account => account.from_email);

    } catch (error) {
      throw new Error(`Failed to fetch existing emails: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private parseCSV(csvData: string): EmailCredential[] {
    try {
      const lines = csvData.trim().split('\n');
      const headers = lines[0].toLowerCase().split(',');
      
      const emailIndex = headers.indexOf('emailaddress');
      const passwordIndex = headers.indexOf('password');
      
      if (emailIndex === -1 || passwordIndex === -1) {
        throw new Error('CSV must contain EmailAddress and Password columns');
      }

      return lines.slice(1).map(line => {
        const values = line.split(',');
        return {
          email: values[emailIndex].trim(),
          password: values[passwordIndex].trim()
        };
      });

    } catch (error) {
      throw new Error(`Failed to parse CSV: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async processLogin(page: puppeteer.Page, credential: EmailCredential): Promise<void> {
    let attempts = 0;
    
    while (attempts < this.maxRetries) {
      try {
        // Navigate to login page with improved options
        await page.goto(this.config.loginUrl, { 
          timeout: 30000,
          waitUntil: 'networkidle0'
        });

        // Wait for and fill email field
        await page.waitForSelector('input[name="loginfmt"]');
        await page.type('input[name="loginfmt"]', credential.email);
        await page.click('input[type="submit"]');

        // Wait for and fill password field
        await page.waitForSelector('input[name="passwd"]');
        await page.type('input[name="passwd"]', credential.password);
        await page.click('input[type="submit"]');

        // Handle "Stay signed in?" prompt
        try {
          await page.waitForSelector('#KmsiCheckboxField', { timeout: 5000 });
          await page.click('#KmsiCheckboxField');
          await page.click('#idBtn_Back');
        } catch (e) {
          // Ignore if prompt doesn't appear
        }

        // Handle "Ask later" prompt
        try {
          await page.waitForSelector('#btnAskLater', { timeout: 5000 });
          await page.click('#btnAskLater');
        } catch (e) {
          // Ignore if prompt doesn't appear
        }

        // Enhanced login verification
        await page.waitForNavigation({ 
          timeout: 10000,
          waitUntil: 'networkidle0'
        });
        
        const currentUrl = page.url();
        if (currentUrl.includes('login') || currentUrl.includes('error') || currentUrl.includes('auth')) {
          throw new Error('Login verification failed - still on login/error page');
        }

        // Additional error verification
        const errorElements = await page.$x("//div[contains(text(), 'error') or contains(text(), 'invalid')]");
        if (errorElements.length > 0) {
          throw new Error('Login verification failed - error message detected');
        }

        return; // Success

      } catch (error) {
        attempts++;
        if (attempts === this.maxRetries) {
          throw new Error(`Max retry attempts reached for ${credential.email}`);
        }
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  private async logAutomation(email: string, status: 'attempt' | 'success' | 'failed', error?: any): Promise<void> {
    const key = `automation:${Date.now()}:${email}`;
    await this.env.KV.put(key, JSON.stringify({
      timestamp: Date.now(),
      email,
      status,
      error: error ? (error instanceof Error ? error.message : 'Unknown error') : undefined
    }));
  }
} 