declare class EnvVars {
    DATABASE_URL: string;
    JWT_SECRET: string;
    JWT_ACCESS_EXPIRES_IN: string;
    JWT_REFRESH_EXPIRES_IN: string;
    ASAAS_ENV: 'sandbox' | 'production';
    ASAAS_API_KEY: string;
    ASAAS_WEBHOOK_TOKEN: string;
    PORT: number;
}
export declare function validateEnv(config: Record<string, unknown>): EnvVars;
export {};
