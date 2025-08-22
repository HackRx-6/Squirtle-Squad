import { Elysia } from "elysia";
import { pdfController } from "../controllers/pdf.controller";

export const pdfRoute = (app: Elysia) => {
    // New HackRX endpoint
    app.post(
        "/api/v1/hackrx/run",
        ({ request }) => pdfController.processHackRX(request),
        {
            detail: {
                summary:
                    "Process PDF from URL with In-Memory Vector Search Q&A",
                description:
                    "Download a PDF from URL, extract text content, create chunks, generate embeddings in-memory, and answer questions using AI without database storage. Fast processing using cosine similarity search.",
                tags: [
                    "PDF Processing",
                    "In-Memory Q&A",
                    "Vector Search",
                    "HackRX",
                ],
                body: {
                    type: "object",
                    properties: {
                        documents: {
                            type: "string",
                            description: "URL to the PDF document to process",
                        },
                        questions: {
                            type: "array",
                            items: {
                                type: "string",
                            },
                            description:
                                "Array of questions to ask about the PDF content",
                        },
                    },
                    required: ["documents", "questions"],
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            answers: {
                                type: "array",
                                items: {
                                    type: "string",
                                },
                                description:
                                    "Array of answer strings corresponding to the questions asked",
                            },
                        },
                    },
                    400: {
                        type: "object",
                        properties: {
                            error: { type: "string" },
                        },
                    },
                    500: {
                        type: "object",
                        properties: {
                            error: { type: "string" },
                        },
                    },
                },
            },
        }
    );

    // Original PDF upload endpoint for backward compatibility
    app.post(
        "/api/v1/process-pdf",
        ({ request }) => pdfController.processPDF(request),
        {
            detail: {
                summary:
                    "Process Documents with AI Q&A (PDF, DOCX, Images, Email)",
                description:
                    "Upload a document (PDF, DOCX, PNG, JPG, JPEG, EML, MSG), extract text content using appropriate methods (OCR for images, text extraction for documents), and answer questions using AI. Images use OCR text directly with LLM, while other documents use vector embeddings for enhanced accuracy.",
                tags: [
                    "Document Processing",
                    "OCR",
                    "In-Memory Q&A",
                    "Vector Search",
                ],
                body: {
                    type: "object",
                    properties: {
                        pdf: {
                            type: "string",
                            format: "binary",
                            description:
                                "Document file to process (PDF, DOCX, PNG, JPG, JPEG, EML, MSG)",
                        },
                        questions: {
                            type: "string",
                            description:
                                'JSON array of questions (simple strings) to ask about the document content. Format: ["What is this document about?", "What are the key points?"]',
                        },
                    },
                    required: ["pdf"],
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            answers: {
                                type: "array",
                                items: {
                                    type: "string",
                                },
                                description:
                                    "Array of answer strings (present only when questions are provided)",
                            },
                            message: {
                                type: "string",
                                description:
                                    "Status message (present when no questions provided)",
                            },
                        },
                    },
                    400: {
                        type: "object",
                        properties: {
                            error: { type: "string" },
                        },
                    },
                    500: {
                        type: "object",
                        properties: {
                            error: { type: "string" },
                        },
                    },
                },

                // COMMENTED OUT - Previous response schema with detailed objects
                /*
                response: {
                    200: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            message: { type: "string" },
                            data: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        question: { type: "string" },
                                        answer: { type: "string" },
                                    },
                                },
                                description:
                                    "Array of question-answer pairs (null if no questions provided)",
                            },
                            status: { type: "number" },
                        },
                    },
                    400: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            message: { type: "string" },
                            status: { type: "number" },
                        },
                    },
                    500: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            message: { type: "string" },
                            status: { type: "number" },
                        },
                    },
                },
                */
            },
        }
    );

    return app;
};
