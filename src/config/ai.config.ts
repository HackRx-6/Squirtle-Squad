import type { AIConfig } from './types'

export class AIConfigService {
    private static instance: AIConfigService;
    private config: AIConfig;

    private constructor() {
        this.config = this.loadConfig();
    }

    public static getInstance(): AIConfigService {
        if (!AIConfigService.instance) {
            AIConfigService.instance = new AIConfigService();
        }
        return AIConfigService.instance;
    }

    private loadConfig(): AIConfig {
        const {
            EMBEDDINGS_MODEL_API_KEY,
            EMBEDDINGS_MODEL_ENDPOINT,
            EMBEDDINGS_MODEL_DEPLOYMENT_NAME,
            EMBEDDINGS_MODEL_API_VERSION,
            EMBEDDINGS_MODEL_API_KEY_2,
            EMBEDDINGS_MODEL_ENDPOINT_2,
            EMBEDDINGS_MODEL_DEPLOYMENT_NAME_2,
            EMBEDDINGS_MODEL_API_VERSION_2,
            LLM_API_KEY,
            LLM_BASE_URL,
            LLM_SERVICE,
            LLM_DEPLOYMENT_NAME,
            LLM_API_VERSION,
            LLM_MODEL,
            LLM_API_KEY_2,
            LLM_BASE_URL_2,
            LLM_SERVICE_2,
            LLM_DEPLOYMENT_NAME_2,
            LLM_API_VERSION_2,
            LLM_MODEL_2,
            // Claude configuration for Excel files
            CLAUDE_API_KEY,
            CLAUDE_BASE_URL,
            CLAUDE_DEPLOYMENT_NAME,
            CLAUDE_MODEL,
            CLAUDE_LLM_SERVICE,
            CLAUDE_API_VERSION,
            // Secondary Claude configuration
            CLAUDE_API_KEY_2,
            CLAUDE_BASE_URL_2,
            CLAUDE_DEPLOYMENT_NAME_2,
            CLAUDE_MODEL_2,
            CLAUDE_LLM_SERVICE_2,
            CLAUDE_API_VERSION_2,
        } = process.env;

        if (
            !EMBEDDINGS_MODEL_API_KEY ||
            !EMBEDDINGS_MODEL_ENDPOINT ||
            !EMBEDDINGS_MODEL_DEPLOYMENT_NAME
        ) {
            throw new Error(
                "Missing embedding model environment variables: EMBEDDINGS_MODEL_API_KEY, EMBEDDINGS_MODEL_ENDPOINT, and EMBEDDINGS_MODEL_DEPLOYMENT_NAME must be set."
            );
        }

        if (!LLM_API_KEY) {
            throw new Error("LLM_API_KEY environment variable is required");
        }

        // Validate baseURL format for primary LLM
        if (LLM_BASE_URL && !LLM_BASE_URL.match(/^https?:\/\/.+/)) {
            throw new Error("LLM_BASE_URL must be a valid HTTP/HTTPS URL");
        }

        // Validate baseURL format for secondary LLM if provided
        if (LLM_BASE_URL_2 && !LLM_BASE_URL_2.match(/^https?:\/\/.+/)) {
            throw new Error("LLM_BASE_URL_2 must be a valid HTTP/HTTPS URL");
        }

        const defaultBaseURL =
            "https://generativelanguage.googleapis.com/v1beta/openai/"; // Gemini default
        const llmBaseURL = LLM_BASE_URL || defaultBaseURL;

        // Auto-detect model based on base URL if not explicitly set
        let defaultModel = "gemini-2.0-flash-exp"; // Default to Gemini

        if (llmBaseURL.includes("anthropic.com")) {
            defaultModel = "claude-3-5-sonnet-20241022";
        } else if (llmBaseURL.includes("openai.com")) {
            defaultModel = "gpt-4o";
        } else if (llmBaseURL.includes("generativelanguage.googleapis.com")) {
            defaultModel = "gemini-2.0-flash-exp";
        }

        const model = process.env.LLM_MODEL || defaultModel;

        // Check if secondary models are configured
        const hasSecondaryEmbedding =
            EMBEDDINGS_MODEL_API_KEY_2 &&
            EMBEDDINGS_MODEL_ENDPOINT_2 &&
            EMBEDDINGS_MODEL_DEPLOYMENT_NAME_2;
        const hasSecondaryLLM = LLM_API_KEY_2 && LLM_BASE_URL_2;

        // Check if Claude is configured for Excel files
        const hasClaudePrimary = CLAUDE_API_KEY && CLAUDE_BASE_URL;

        // EXTENSIVE DEBUGGING - Log configuration details
        console.log("=================== 🔧 AI CONFIG DEBUG START ===================");
        console.log(`🔧 RAW ENVIRONMENT VARIABLES:`);
        console.log(`   LLM_API_KEY: ${LLM_API_KEY ? `[SET - Length: ${LLM_API_KEY.length}, Starts: ${LLM_API_KEY.substring(0, 15)}...]` : "[NOT SET OR EMPTY]"}`);
        console.log(`   LLM_BASE_URL: "${LLM_BASE_URL || "NOT SET"}"`);
        console.log(`   LLM_MODEL: "${LLM_MODEL || "NOT SET"}"`);
        console.log(`   LLM_SERVICE: "${LLM_SERVICE || "NOT SET"}"`);
        console.log(`   LLM_DEPLOYMENT_NAME: "${LLM_DEPLOYMENT_NAME || "NOT SET"}"`);
        console.log(`   LLM_API_VERSION: "${LLM_API_VERSION || "NOT SET"}"`);
        
        console.log(`🔧 PROCESSED VALUES:`);
        console.log(`   Computed Base URL: "${llmBaseURL}"`);
        console.log(`   Computed Model: "${model}"`);
        console.log(`   Default Base URL Used: "${defaultBaseURL}"`);
        
        console.log(`🔧 VALIDATION RESULTS:`);
        console.log(`   Has API Key: ${!!LLM_API_KEY}`);
        console.log(`   Base URL Valid: ${LLM_BASE_URL ? LLM_BASE_URL.match(/^https?:\/\/.+/) ? "YES" : "INVALID FORMAT" : "NOT SET"}`);
        
        console.log(`🔧 EMBEDDING VARIABLES:`);
        console.log(`   EMBEDDINGS_MODEL_API_KEY: ${EMBEDDINGS_MODEL_API_KEY ? `[SET - Length: ${EMBEDDINGS_MODEL_API_KEY.length}]` : "[NOT SET]"}`);
        console.log(`   EMBEDDINGS_MODEL_ENDPOINT: "${EMBEDDINGS_MODEL_ENDPOINT || "NOT SET"}"`);
        console.log(`   EMBEDDINGS_MODEL_DEPLOYMENT_NAME: "${EMBEDDINGS_MODEL_DEPLOYMENT_NAME || "NOT SET"}"`);
        console.log("=================== 🔧 AI CONFIG DEBUG END ===================");

        if (hasSecondaryLLM) {
            console.log(`   Secondary - Base URL: ${LLM_BASE_URL_2}`);
            console.log(`   Secondary - Model: ${LLM_MODEL_2 || "grok-3"}`);
            console.log(
                `   Secondary - API Key: ${
                    LLM_API_KEY_2 ? "[SET]" : "[NOT SET]"
                }`
            );
        }

        if (hasClaudePrimary) {
            console.log(`🔧 Claude Configuration (for Excel files):`);
            console.log(`   Primary - Base URL: ${CLAUDE_BASE_URL}`);
            console.log(
                `   Primary - Model: ${
                    CLAUDE_MODEL || "claude-3-5-sonnet-20241022"
                }`
            );
            console.log(
                `   Primary - API Key: ${
                    CLAUDE_API_KEY ? "[SET]" : "[NOT SET]"
                }`
            );
        }

        if (hasSecondaryEmbedding) {
            console.log(`🔧 Embedding Configuration:`);
            console.log(`   Primary - Endpoint: ${EMBEDDINGS_MODEL_ENDPOINT}`);
            console.log(
                `   Secondary - Endpoint: ${EMBEDDINGS_MODEL_ENDPOINT_2}`
            );
        }

        return {
            openAI: {
                primary: {
                    apiKey: EMBEDDINGS_MODEL_API_KEY,
                    endpoint: EMBEDDINGS_MODEL_ENDPOINT,
                    deploymentName: EMBEDDINGS_MODEL_DEPLOYMENT_NAME,
                    embeddingModel: "text-embedding-3-large",
                    apiVersion: EMBEDDINGS_MODEL_API_VERSION || "2024-06-01",
                },
                ...(hasSecondaryEmbedding && {
                    secondary: {
                        apiKey: EMBEDDINGS_MODEL_API_KEY_2!,
                        endpoint: EMBEDDINGS_MODEL_ENDPOINT_2!,
                        deploymentName: EMBEDDINGS_MODEL_DEPLOYMENT_NAME_2!,
                        embeddingModel: "text-embedding-3-large",
                        apiVersion:
                            EMBEDDINGS_MODEL_API_VERSION_2 || "2024-06-01",
                    },
                }),
            },
            llm: {
                primary: {
                    apiKey: LLM_API_KEY,
                    baseURL: llmBaseURL,
                    model: LLM_MODEL || "gpt-4.1",
                    service: LLM_SERVICE,
                    name: LLM_DEPLOYMENT_NAME,
                    apiVersion: LLM_API_VERSION,
                },
                ...(hasSecondaryLLM && {
                    secondary: {
                        apiKey: LLM_API_KEY_2!,
                        baseURL: LLM_BASE_URL_2!,
                        model: LLM_MODEL_2 || "grok-3",
                        service: LLM_SERVICE_2 || "azure",
                        name: LLM_DEPLOYMENT_NAME_2,
                        apiVersion: LLM_API_VERSION_2 || "2024-05-01-preview",
                    },
                }),
            },
            claude: {
                primary: {
                    apiKey: CLAUDE_API_KEY || "",
                    baseURL: CLAUDE_BASE_URL || "",
                    model: CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
                    service: CLAUDE_LLM_SERVICE || "anthropic",
                    name: CLAUDE_DEPLOYMENT_NAME,
                    apiVersion: CLAUDE_API_VERSION,
                },
                ...(CLAUDE_API_KEY_2 &&
                    CLAUDE_BASE_URL_2 && {
                        secondary: {
                            apiKey: CLAUDE_API_KEY_2,
                            baseURL: CLAUDE_BASE_URL_2,
                            model:
                                CLAUDE_MODEL_2 || "claude-3-5-sonnet-20241022",
                            service: CLAUDE_LLM_SERVICE_2 || "anthropic",
                            name: CLAUDE_DEPLOYMENT_NAME_2,
                            apiVersion: CLAUDE_API_VERSION_2,
                        },
                    }),
            },
        };
    }

    public getOpenAIConfig() {
        return this.config.openAI;
    }

    public getAnthropicConfig() {
        return this.config.llm;
    }

    public getLLMConfig() {
        return this.config.llm;
    }

    public getPrimaryOpenAIConfig() {
        return this.config.openAI.primary;
    }

    public getSecondaryOpenAIConfig() {
        return this.config.openAI.secondary;
    }

    public getPrimaryLLMConfig() {
        return this.config.llm.primary;
    }

    public getSecondaryLLMConfig() {
        return this.config.llm.secondary;
    }

    public getPrimaryClaudeConfig() {
        return this.config.claude.primary;
    }

    public getSecondaryClaudeConfig() {
        return this.config.claude.secondary;
    }

    public hasSecondaryEmbedding(): boolean {
        return !!this.config.openAI.secondary;
    }

    public hasSecondaryLLM(): boolean {
        return !!this.config.llm.secondary;
    }

    public hasClaudeConfigured(): boolean {
        return !!(
            this.config.claude.primary.apiKey &&
            this.config.claude.primary.baseURL
        );
    }

    public hasSecondaryClaudeConfigured(): boolean {
        return !!(
            this.config.claude.secondary?.apiKey &&
            this.config.claude.secondary?.baseURL
        );
    }
}
