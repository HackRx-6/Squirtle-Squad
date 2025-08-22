import { DocumentProcessingService } from "../services/processing";
import { InMemoryQAService } from "../services/qa";
import { ImageQAService } from "../services/qa";
import { globalTimerService } from "../services/timer";
import { ApiError } from "../utils/ApiError";
import { sentryMonitoringService } from "../services/monitoring";

import { PromptInjectionProtectionService } from "../services/cleaning";
import type { BunFile } from "bun";
import type { Question } from "../types/document.types";

export const pdfController = {
  async processHackRX(request: Request): Promise<Response> {
    // Start global timer immediately when API is hit
    const timerContext = globalTimerService.startTimer(`hackrx_${Date.now()}`);

    return await sentryMonitoringService.track(
      "hackrx_processing_endpoint",
      "pdf_processing",
      {
        endpoint: "/hackrx/run",
        method: "POST",
        timer_enabled: timerContext.timeoutMs !== Infinity,
        timeout_seconds: timerContext.timeoutMs / 1000,
      },
      async () => {
        let body: any = {};
        try {
          // Check timer at the start of processing
          if (timerContext.isExpired) {
            console.warn("⏰ Request already timed out at start");
            return new Response(
              JSON.stringify({
                answers: [
                  "I apologize, but the request timed out before processing could begin. Please try again.",
                ],
                timeout: true,
                elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
              }),
              {
                status: 200, // Return 200 but indicate timeout
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          body = (await request.json()) as {
            documents?: string;
            questions?: string[];
          };
          console.log("COMPLETE REQUEST", JSON.stringify(body));
          const { documents, questions: rawQuestions } = body;

          if (!documents || typeof documents !== "string") {
            throw new ApiError(
              400,
              'No document URL provided. Please include a "documents" field with the document URL'
            );
          }

          if (!rawQuestions || !Array.isArray(rawQuestions)) {
            throw new ApiError(
              400,
              'No questions provided. Please include a "questions" field with an array of questions'
            );
          }

          // SECURITY: Sanitize user questions for prompt injection attacks
          const questions: string[] = [];
          let highRiskQuestionsDetected = 0;

          console.log(
            `🛡️ Sanitizing ${rawQuestions.length} questions for security...`
          );

          // Check if prompt injection protection is enabled
          if (!PromptInjectionProtectionService.isEnabled()) {
            console.log(
              "🔓 Prompt injection protection disabled - using questions as-is"
            );
            questions.push(...rawQuestions);
          } else {
            console.log(
              "🛡️ Prompt injection protection enabled - processing questions"
            );

            for (let i = 0; i < rawQuestions.length; i++) {
              const question = rawQuestions[i];
              if (typeof question !== "string") {
                throw new ApiError(400, `Question ${i + 1} must be a string`);
              }

              // Assess risk level of each question
              const riskAssessment =
                PromptInjectionProtectionService.calculateRiskScore(question);

              if (riskAssessment.risk === "critical") {
                console.warn(
                  `🚨 Critical risk question detected and blocked:`,
                  {
                    questionIndex: i + 1,
                    riskScore: riskAssessment.score,
                    detectedPatterns: riskAssessment.detectedPatterns,
                    questionPreview: question.substring(0, 100) + "...",
                  }
                );

                // Block critical risk questions entirely
                questions.push(
                  "I cannot process this question as it contains potentially harmful content. Please rephrase your question."
                );
                highRiskQuestionsDetected++;
              } else if (riskAssessment.risk === "high") {
                console.warn(`⚠️ High risk question sanitized:`, {
                  questionIndex: i + 1,
                  riskScore: riskAssessment.score,
                  detectedPatterns: riskAssessment.detectedPatterns,
                });

                // Sanitize high risk questions
                const sanitized =
                  PromptInjectionProtectionService.sanitizeText(question);
                questions.push(sanitized);
                highRiskQuestionsDetected++;
              } else {
                // Low to medium risk questions get basic sanitization
                const sanitized =
                  PromptInjectionProtectionService.sanitizeText(question);
                questions.push(sanitized);
              }
            }
          }

          // Log security summary
          if (highRiskQuestionsDetected > 0) {
            console.warn(
              `🛡️ Security Summary: ${highRiskQuestionsDetected}/${rawQuestions.length} questions required high-level sanitization`
            );
          }

          console.log(`📄 Processing document from URL: ${documents}`);
          console.log(`📋 Received ${questions.length} questions to process`);
          console.log(
            `⏰ Global timer started: ${
              timerContext.timeoutMs / 1000
            }s timeout (ID: ${timerContext.id})`
          );

          // Check timer before starting parallel processing
          if (timerContext.isExpired) {
            console.warn("⏰ Timer expired during initial setup");
            return new Response(
              JSON.stringify({
                answers: questions.map(
                  () => "Request timed out during processing setup."
                ),
                timeout: true,
                elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          // If the provided URL is not a known document type, treat it as a web-only query via tool-calls
          const urlSegments = documents.split("/");
          const lastSegment = urlSegments[urlSegments.length - 1];
          const detectedFileName = lastSegment
            ? lastSegment.split("?")[0] || "document.pdf"
            : "document.pdf";

          const nonDocUrl =
            !/[.](pdf|docx|pptx|eml|msg|png|jpg|jpeg|xlsx)$/i.test(
              detectedFileName
            );

          if (nonDocUrl) {
            console.log(
              "🌐 Detected non-document URL. Using web tool-call flow."
            );

            const qaService = new InMemoryQAService();

            // Prepare web context (include the documents URL in the question text so it gets picked up)
            const { webContextService } = await import(
              "../services/webScraping"
            );

            const augmentedQuestions = questions.map(
              (q: string) => `${q}\nURL: ${documents}`
            );

            // Build combined web chunks for all questions (best-effort; first question drives scraping)
            const webPrep = await webContextService.enrichContextWithWebContent(
              {
                question: augmentedQuestions[0] || documents,
                retrievedChunks: [],
                timerAbort: timerContext.abortController.signal,
              }
            );

            if (!webPrep.webChunks.length) {
              console.warn(
                "⚠️ No web content could be extracted from the URL."
              );
              const response = {
                answers: questions.map(
                  () =>
                    "I couldn't extract any readable content from the provided URL. Please share a document or a different link."
                ),
              };
              return new Response(JSON.stringify(response), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }

            // Ingest web chunks into vector store and answer
            await qaService.processDocument(
              webPrep.webChunks,
              detectedFileName || "web",
              webPrep.webChunks.length
            );

            const streamingAnswers =
              await qaService.answerMultipleQuestionsWithStreaming(
                augmentedQuestions,
                detectedFileName || "web",
                timerContext
              );

            const answers = streamingAnswers.map((answer) =>
              answer.replace(/\n+/g, " ").replace(/\s+/g, " ").trim()
            );

            const response = { answers };
            console.log(
              "📤 Complete response body being sent (web-only):",
              JSON.stringify(response, null, 2)
            );

            return new Response(JSON.stringify(response), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          // OPTIMIZATION: Start question embedding generation in parallel with PDF download
          console.log(
            `🚀 Starting parallel processing: Document download + question embedding generation`
          );

          const qaService = new InMemoryQAService();

          // Start question embeddings generation (no timeout for questions)
          const questionEmbeddingsPromise = sentryMonitoringService.track(
            "parallel_question_embeddings",
            "embedding",
            {
              question_count: questions.length,
              parallel_optimization: true,
            },
            async () => {
              console.log(
                `🧮 Pre-generating embeddings for ${questions.length} questions while document downloads...`
              );
              return qaService.preGenerateQuestionEmbeddings(questions);
            },
            {
              component: "parallel_optimization",
              operation: "question_embeddings_pre_generation",
            }
          );

          // Check if it's a PPTX file from URL - handle with hardcoded prompt

          // Check if it's a URL-based file (.bin, .zip) that should only fetch metadata
          // Note: .xlsx, .docx, .pptx files are NOT URL-based files, they should be processed normally
          const isUrlBasedFile =
            (detectedFileName.toLowerCase().endsWith(".bin") ||
              detectedFileName.toLowerCase().endsWith(".zip")) &&
            !detectedFileName.toLowerCase().endsWith(".xlsx") &&
            !detectedFileName.toLowerCase().endsWith(".docx") &&
            !detectedFileName.toLowerCase().endsWith(".pptx");
          if (isUrlBasedFile) {
            // For .bin and .zip files, reject them directly
            console.log(
              `🚫 Rejecting URL-based file: ${detectedFileName} - File too large`
            );

            const response = {
              answers: ["Document Rejected! File too large"],
            };

            console.log(
              "📤 Complete response body being sent:",
              JSON.stringify(response, null, 2)
            );

            return new Response(JSON.stringify(response), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          // Start document download in parallel
          const documentDownloadPromise = sentryMonitoringService.track(
            "parallel_document_download",
            "pdf_processing",
            {
              document_url: documents,
              asked_questions: questions,
              raw_body: body,
              parallel_optimization: true,
            },
            async () => {
              const response = await fetch(documents);
              if (!response.ok) {
                throw new Error(
                  `Failed to download document: ${response.status} ${response.statusText}`
                );
              }
              const arrayBuffer = await response.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);

              console.log(
                `📥 Downloaded document: ${(
                  buffer.length /
                  1024 /
                  1024
                ).toFixed(2)}MB`
              );
              return buffer;
            },
            {
              component: "parallel_optimization",
              operation: "document_download",
            }
          );

          // Wait for both operations to complete
          let documentBuffer: Buffer;
          let preGeneratedEmbeddings: number[][] | null;

          try {
            const [downloadResult, embeddingResult] = await Promise.all([
              documentDownloadPromise,
              questionEmbeddingsPromise,
            ]);

            documentBuffer = downloadResult;
            preGeneratedEmbeddings = embeddingResult;

            const embeddingCount = preGeneratedEmbeddings
              ? preGeneratedEmbeddings.length
              : 0;
            console.log(
              `⚡ Parallel optimization complete! Document downloaded + ${embeddingCount}/${questions.length} question embeddings ready`
            );
          } catch (error) {
            // If document download fails, we still want to stop gracefully
            if (
              error instanceof Error &&
              error.message.includes("Failed to download PDF")
            ) {
              throw new ApiError(
                400,
                `Failed to download PDF from URL: ${error.message}`
              );
            }

            // If only embedding pre-generation fails, we can continue without it
            console.warn(
              `⚠️ Question embedding pre-generation failed, will generate during Q&A phase: ${
                error instanceof Error ? error.message : "Unknown error"
              }`
            );

            // Still try to get the PDF if the download succeeded
            try {
              documentBuffer = await documentDownloadPromise;
              preGeneratedEmbeddings = null;
            } catch (pdfError) {
              throw new ApiError(
                400,
                `Failed to download PDF from URL: ${
                  pdfError instanceof Error ? pdfError.message : "Unknown error"
                }`
              );
            }
          }

          // Extract filename from URL or use default
          const urlParts = documents.split("/");
          const lastPart = urlParts[urlParts.length - 1];
          const fileName = lastPart
            ? lastPart.split("?")[0] || "document.pdf"
            : "document.pdf";

          // Validate file size (e.g., max 5000MB)
          const maxSize = 5000 * 1024 * 1024; // 5000MB in bytes
          if (documentBuffer.length > maxSize) {
            throw new ApiError(
              400,
              `File size too large. Maximum allowed size is ${
                maxSize / 1024 / 1024
              }MB`
            );
          }

          // Process document (text extraction and chunking)
          const documentService = new DocumentProcessingService();
          const processedDocument = await documentService.processDocument(
            documentBuffer,
            fileName
          );

          // Process questions using appropriate method based on document type
          console.log(
            `🤔 Processing ${
              questions.length
            } questions for ${processedDocument.documentType.toUpperCase()}${
              preGeneratedEmbeddings ? " (using pre-generated embeddings)" : ""
            }`
          );

          let answers: string[] = [];

          try {
            // Handle images differently - use OCR text directly without embeddings
            if (processedDocument.documentType === "image") {
              console.log(
                `🖼️ Using direct OCR-to-LLM processing for image (no vector embeddings)`
              );

              const imageQAService = new ImageQAService();

              try {
                answers = await imageQAService.answerQuestionsWithOCRText(
                  questions,
                  processedDocument.content,
                  fileName,
                  timerContext
                );

                console.log(
                  `✅ Generated ${answers.length} answers for ${questions.length} image questions using OCR text`
                );

                // Log memory usage stats (minimal for images)
                const memoryStats = imageQAService.getMemoryStats();
                console.log(
                  `💾 Image processing memory usage: ${memoryStats.estimatedMemoryMB}MB for ${memoryStats.chunkCount} OCR text chunks`
                );
              } catch (error) {
                console.error("❌ Error processing image questions:", error);

                // Check if error was due to timeout
                const isTimeout =
                  timerContext.isExpired ||
                  (error instanceof Error && error.message.includes("timeout"));

                if (isTimeout) {
                  console.warn("⏰ Image Q&A processing timed out");
                  answers = questions.map(
                    () =>
                      "I apologize, but I wasn't able to complete the response within the time limit. Please try again with a more specific question."
                  );
                } else {
                  // Return error answers if Q&A fails for other reasons
                  answers = questions.map(
                    () =>
                      `Error processing question about image: ${
                        error instanceof Error ? error.message : "Unknown error"
                      }`
                  );
                }
              }
            } else if (
              processedDocument.documentType === "pdf" &&
              processedDocument.totalPages < 5
            ) {
              // Small PDF optimization: skip embeddings/vector search; send full content + question
              console.log(
                `📄 Small PDF detected (${processedDocument.totalPages} pages). Skipping embeddings/vector search and using full-content context.`
              );

              try {
                const fullContentAnswers =
                  await qaService.answerMultipleQuestionsWithFullContent(
                    questions,
                    processedDocument.content,
                    timerContext
                  );

                answers = fullContentAnswers.map((answer) =>
                  answer.replace(/\n+/g, " ").replace(/\s+/g, " ").trim()
                );
              } catch (error) {
                console.error(
                  "❌ Error processing small-PDF questions:",
                  error
                );
                answers = questions.map(
                  () =>
                    "I apologize, but there was an error processing your question."
                );
              }
            } else {
              // Handle PDF, DOCX, and other document files with vector embeddings
              console.log(
                `📄 Using vector embedding-based Q&A for ${processedDocument.documentType.toUpperCase()}`
              );

              // Load chunks into memory
              await qaService.processDocument(
                processedDocument.chunks,
                fileName,
                processedDocument.totalPages
              );

              // Answer questions using precomputed embeddings if available
              // NEW: Use streaming with timer support
              console.log(
                "🌊 Starting streaming Q&A with global timer support..."
              );

              const streamingAnswers =
                await qaService.answerMultipleQuestionsWithStreaming(
                  questions,
                  fileName,
                  timerContext
                );

              // Use the streaming results
              answers = streamingAnswers.map((answer) => {
                // Clean up the text response by normalizing whitespace and line breaks
                return answer
                  .replace(/\n+/g, " ") // Replace multiple newlines with single space
                  .replace(/\s+/g, " ") // Replace multiple spaces with single space
                  .trim(); // Remove leading/trailing whitespace
              });

              // COMMENTED OUT - Previous implementation with detailed answer objects
              /*
                            // Parse each JSON answer and combine all answers into a single response
                            for (const qa of questionAnswers) {
                                try {
                                    const parsedAnswer = JSON.parse(qa.answer);
                                    if (
                                        parsedAnswer.answers &&
                                        Array.isArray(parsedAnswer.answers)
                                    ) {
                                        allAnswers.push(...parsedAnswer.answers);
                                    }
                                } catch (parseErr) {
                                    console.error(
                                        "Failed to parse answer JSON:",
                                        parseErr
                                    );
                                    // Fallback: create a simple answer object
                                    allAnswers.push({
                                        answer: qa.answer,
                                        citation: {
                                            page: 0,
                                            section: "Unknown",
                                            excerpt: "Unable to parse response",
                                        },
                                    });
                                }
                            }
                            */

              console.log(
                `✅ Generated ${answers.length} answers for ${questions.length} questions using streaming + timer`
              );

              // Log timer statistics
              const elapsedSeconds =
                (Date.now() - timerContext.startTime) / 1000;
              const remainingSeconds = Math.max(
                0,
                (timerContext.timeoutMs -
                  (Date.now() - timerContext.startTime)) /
                  1000
              );
              console.log(
                `⏰ Timer status: ${elapsedSeconds.toFixed(
                  1
                )}s elapsed, ${remainingSeconds.toFixed(1)}s remaining`
              );

              // Log memory usage stats
              const memoryStats = qaService.getMemoryStats();
              console.log(
                `💾 Memory usage: ${memoryStats.estimatedMemoryMB}MB for ${memoryStats.chunkCount} chunks`
              );
            }
          } catch (error) {
            console.error("❌ Error processing questions:", error);

            // Check if error was due to timeout
            const isTimeout =
              timerContext.isExpired ||
              (error instanceof Error && error.message.includes("timeout"));

            if (isTimeout) {
              console.warn("⏰ Q&A processing timed out");
              answers = questions.map(
                () =>
                  "I apologize, but I wasn't able to complete the response within the time limit. Please try again with a more specific question."
              );
            } else {
              // Return error answers if Q&A fails for other reasons
              answers = questions.map(
                () =>
                  `Error processing question: ${
                    error instanceof Error ? error.message : "Unknown error"
                  }`
              );
            }
          } finally {
            // Clean up memory after processing
            qaService.cleanup();

            // Complete the timer if it's still active
            if (!timerContext.isExpired) {
              globalTimerService.completeTimer(timerContext.id);
            }
          }

          // Return the new simplified response format - just array of answer strings
          const elapsedSeconds = (Date.now() - timerContext.startTime) / 1000;
          const response = {
            answers,
          };

          // Log complete request body before sending response
          console.log(
            "📤 Complete request body before sending response:",
            JSON.stringify(body, null, 2)
          );

          // Log complete response body before sending
          console.log(
            "📤 Complete response body being sent:",
            JSON.stringify(response, null, 2)
          );

          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          // Complete the timer in case of error
          if (!timerContext.isExpired) {
            globalTimerService.completeTimer(timerContext.id);
          }

          console.error("Error in HackRX processing endpoint:", error);

          // Log complete request body before sending error response
          try {
            console.log(
              "📤 Complete request body before sending error response:",
              JSON.stringify(body, null, 2)
            );
          } catch (logError) {
            console.log("📤 Could not log request body:", logError);
          }

          if (error instanceof ApiError) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: error.statusCode,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(
            JSON.stringify({
              error: "Internal server error while processing PDF",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },
      {
        component: "api_controller",
        endpoint: "/hackrx/run",
      }
    );
  },

  async processPDF(request: Request): Promise<Response> {
    // Start global timer for PDF processing endpoint as well
    const timerContext = globalTimerService.startTimer(
      `pdf_upload_${Date.now()}`
    );
    // Log the whole request object
    console.log("🔎 Incoming request object (processPDF):", request);

    return await sentryMonitoringService.track(
      "pdf_processing_endpoint",
      "pdf_processing",
      {
        endpoint: "/process-pdf",
        method: "POST",
        timer_enabled: timerContext.timeoutMs !== Infinity,
        timeout_seconds: timerContext.timeoutMs / 1000,
      },
      async () => {
        let requestBodyForLogging: any = {};
        try {
          // Check timer at the start of processing
          if (timerContext.isExpired) {
            console.warn("⏰ Request already timed out at start");
            return new Response(
              JSON.stringify({
                message: "Processing timed out before completion",
                timeout: true,
                elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          const formData = await request.formData();
          const fileEntry = formData.get("pdf");
          const questionsEntry = formData.get("questions");

          // Create simplified request body representation for logging
          requestBodyForLogging = {
            pdf: fileEntry
              ? {
                  name: (fileEntry as BunFile).name || "uploaded-file.pdf",
                  size: (fileEntry as BunFile).size || 0,
                  type: (fileEntry as BunFile).type || "unknown",
                }
              : null,
            questions: questionsEntry || null,
          };

          if (!fileEntry || typeof fileEntry === "string") {
            throw new ApiError(
              400,
              'No PDF file provided. Please include a file with key "pdf"'
            );
          }

          const file = fileEntry as BunFile;
          const fileName = file.name || "uploaded-file.pdf";

          // Parse questions if provided - expect simple array of strings
          let questions: Question[] = [];
          if (questionsEntry && typeof questionsEntry === "string") {
            try {
              const parsedQuestions = JSON.parse(questionsEntry);
              if (Array.isArray(parsedQuestions)) {
                // Support both array of strings and array of objects with question property
                questions = parsedQuestions.map((q) =>
                  typeof q === "string" ? q : q.question || q
                );
                console.log(
                  `📋 Received ${questions.length} questions to process`
                );
              }
            } catch (error) {
              console.warn(
                "⚠️ Failed to parse questions JSON, proceeding without Q&A:",
                error
              );
            }
          }

          // Validate file type - support PDF, DOCX, PPTX, email files, and images
          const supportedExtensions = [
            ".pdf",
            ".docx",
            ".pptx",
            ".eml",
            ".msg",
            ".png",
            ".jpg",
            ".jpeg",
          ];
          const fileType = file.type || "";

          const isValidType =
            fileType.includes("pdf") ||
            fileType.includes("wordprocessingml") ||
            fileType.includes("presentationml") ||
            fileType.includes("outlook") ||
            fileType.includes("rfc822") ||
            fileType.includes("image/png") ||
            fileType.includes("image/jpeg") ||
            fileType.includes("image/jpg") ||
            supportedExtensions.some((ext) =>
              fileName.toLowerCase().endsWith(ext)
            );

          if (!isValidType) {
            throw new ApiError(
              400,
              "Invalid file type. Supported formats: PDF (.pdf), Word documents (.docx), PowerPoint presentations (.pptx), email files (.eml, .msg), and images (.png, .jpg, .jpeg)"
            );
          }

          // Validate file size (e.g., max 50MB)
          const maxSize = 50 * 1024 * 1024; // 50MB in bytes
          if (file.size > maxSize) {
            throw new ApiError(
              400,
              `File size too large. Maximum allowed size is ${
                maxSize / 1024 / 1024
              }MB`
            );
          }

          console.log(
            `📄 Received document file: ${fileName} (${(
              file.size /
              1024 /
              1024
            ).toFixed(2)}MB)`
          );
          console.log(
            `⏰ Global timer started: ${
              timerContext.timeoutMs / 1000
            }s timeout (ID: ${timerContext.id})`
          );

          // Check timer before processing
          if (timerContext.isExpired) {
            console.warn("⏰ Timer expired during file validation");
            return new Response(
              JSON.stringify({
                message: "Processing timed out during file validation",
                timeout: true,
                elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          // Convert file to buffer
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Process document (text extraction and chunking only)
          const documentService = new DocumentProcessingService();
          const processedDocument = await documentService.processDocument(
            buffer,
            fileName
          );

          // Process questions if provided
          let answersArray: string[] = [];
          if (questions.length > 0) {
            console.log(
              `🤔 Processing ${
                questions.length
              } questions for ${processedDocument.documentType.toUpperCase()}`
            );

            // Handle images differently - use OCR text directly without embeddings
            if (processedDocument.documentType === "image") {
              console.log(
                `🖼️ Using direct OCR-to-LLM processing for image (no vector embeddings)`
              );

              const imageQAService = new ImageQAService();

              try {
                answersArray = await imageQAService.answerQuestionsWithOCRText(
                  questions,
                  processedDocument.content,
                  fileName,
                  timerContext
                );

                console.log(
                  `✅ Generated ${answersArray.length} answers for ${questions.length} image questions using OCR text`
                );

                // Log memory usage stats (minimal for images)
                const memoryStats = imageQAService.getMemoryStats();
                console.log(
                  `💾 Image processing memory usage: ${memoryStats.estimatedMemoryMB}MB for ${memoryStats.chunkCount} OCR text chunks`
                );
              } catch (error) {
                console.error("❌ Error processing image questions:", error);

                // Check if error was due to timeout
                const isTimeout =
                  timerContext.isExpired ||
                  (error instanceof Error && error.message.includes("timeout"));

                if (isTimeout) {
                  console.warn("⏰ Image Q&A processing timed out");
                  answersArray = questions.map(
                    () =>
                      "I apologize, but I wasn't able to complete the response within the time limit. Please try again with a more specific question."
                  );
                } else {
                  // Don't fail the entire request if Q&A fails
                  answersArray = questions.map(
                    (q) =>
                      `Error processing question about image: ${
                        error instanceof Error
                          ? error.message
                          : "Unknown error occurred"
                      }`
                  );
                }
              }
            } else if (
              processedDocument.documentType === "pdf" &&
              processedDocument.totalPages < 5
            ) {
              // Small PDF optimization: skip embeddings/vector search; send full content + question
              console.log(
                `📄 Small PDF detected (${processedDocument.totalPages} pages). Skipping embeddings/vector search and using full-content context.`
              );

              const qaService = new InMemoryQAService();

              try {
                const streamingAnswers =
                  await qaService.answerMultipleQuestionsWithFullContent(
                    questions,
                    processedDocument.content,
                    timerContext
                  );

                // Use the streaming results
                answersArray = streamingAnswers.map((answer) =>
                  answer.replace(/\n+/g, " ").replace(/\s+/g, " ").trim()
                );

                console.log(
                  `✅ Generated ${answersArray.length} answers for ${questions.length} questions using full-content streaming`
                );
              } catch (error) {
                console.error(
                  "❌ Error processing small-PDF questions:",
                  error
                );
                const isTimeout =
                  timerContext.isExpired ||
                  (error instanceof Error && error.message.includes("timeout"));
                if (isTimeout) {
                  console.warn("⏰ Full-content Q&A processing timed out");
                  answersArray = questions.map(
                    () =>
                      "I apologize, but I wasn't able to complete the response within the time limit. Please try again with a more specific question."
                  );
                } else {
                  answersArray = questions.map(
                    () =>
                      "I apologize, but there was an error processing your question."
                  );
                }
              }
            } else {
              // Handle PDF, DOCX, and email files with vector embeddings
              console.log(
                `📄 Using vector embedding-based Q&A for ${processedDocument.documentType.toUpperCase()}`
              );

              const qaService = new InMemoryQAService();

              try {
                // Load chunks into memory (instead of uploading to AstraDB)
                await qaService.processDocument(
                  processedDocument.chunks,
                  fileName,
                  processedDocument.totalPages
                );

                // Use streaming approach with timer support
                console.log(
                  "🌊 Starting streaming Q&A with global timer support..."
                );

                const streamingAnswers =
                  await qaService.answerMultipleQuestionsWithStreaming(
                    questions,
                    fileName,
                    timerContext
                  );

                // Use the streaming results
                answersArray = streamingAnswers.map((answer) => {
                  // Clean up the text response by normalizing whitespace and line breaks
                  return answer
                    .replace(/\n+/g, " ") // Replace multiple newlines with single space
                    .replace(/\s+/g, " ") // Replace multiple spaces with single space
                    .trim(); // Remove leading/trailing whitespace
                });

                console.log(
                  `✅ Generated ${answersArray.length} answers for ${questions.length} questions using streaming + timer`
                );

                // Log timer statistics
                const elapsedSeconds =
                  (Date.now() - timerContext.startTime) / 1000;
                const remainingSeconds = Math.max(
                  0,
                  (timerContext.timeoutMs -
                    (Date.now() - timerContext.startTime)) /
                    1000
                );
                console.log(
                  `⏰ Timer status: ${elapsedSeconds.toFixed(
                    1
                  )}s elapsed, ${remainingSeconds.toFixed(1)}s remaining`
                );

                // Log memory usage stats
                const memoryStats = qaService.getMemoryStats();
                console.log(
                  `💾 Memory usage: ${memoryStats.estimatedMemoryMB}MB for ${memoryStats.chunkCount} chunks`
                );
              } catch (error) {
                console.error("❌ Error processing questions:", error);

                // Check if error was due to timeout
                const isTimeout =
                  timerContext.isExpired ||
                  (error instanceof Error && error.message.includes("timeout"));

                if (isTimeout) {
                  console.warn("⏰ Q&A processing timed out");
                  answersArray = questions.map(
                    () =>
                      "I apologize, but I wasn't able to complete the response within the time limit. Please try again with a more specific question."
                  );
                } else {
                  // Don't fail the entire request if Q&A fails
                  answersArray = questions.map(
                    (q) =>
                      `Error processing question: ${
                        error instanceof Error
                          ? error.message
                          : "Unknown error occurred"
                      }`
                  );
                }
              }
            }
          }

          // Return the new simplified response format - just array of answer strings
          const elapsedSeconds = (Date.now() - timerContext.startTime) / 1000;

          if (answersArray.length > 0) {
            // Log complete request body before sending response
            console.log(
              "📤 Complete request body before sending response:",
              JSON.stringify(requestBodyForLogging, null, 2)
            );

            const response = {
              answers: answersArray,
            };

            // Log complete response body before sending
            console.log(
              "📤 Complete response body being sent:",
              JSON.stringify(response, null, 2)
            );

            return new Response(JSON.stringify(response), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          // COMMENTED OUT - Previous ApiResponse format
          /*
                    // Create simplified response
                    const response = new ApiResponse({
                        statusCode: 200,
                        data: answers.length > 0 ? answers : null,
                        message:
                            questions.length > 0
                                ? `PDF processed successfully and ${answers.length} questions answered using in-memory vector search`
                                : "PDF processed successfully (no database storage - using in-memory processing)",
                    });

                    return new Response(JSON.stringify(response.toJSON()), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                    */

          // For PDF only processing (no questions)
          // Log complete request body before sending response
          console.log(
            "📤 Complete request body before sending response:",
            JSON.stringify(requestBodyForLogging, null, 2)
          );

          const response = {
            message: "PDF processed successfully (no questions provided)",
          };

          // Log complete response body before sending
          console.log(
            "📤 Complete response body being sent:",
            JSON.stringify(response, null, 2)
          );

          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          // Complete the timer in case of error
          if (!timerContext.isExpired) {
            globalTimerService.completeTimer(timerContext.id);
          }

          console.error("Error in PDF processing endpoint:", error);

          // Log complete request body before sending error response
          try {
            console.log(
              "📤 Complete request body before sending error response:",
              JSON.stringify(requestBodyForLogging, null, 2)
            );
          } catch (logError) {
            console.log("📤 Could not log request body:", logError);
          }

          if (error instanceof ApiError) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: error.statusCode,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(
            JSON.stringify({
              error: "Internal server error while processing PDF",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );

          // COMMENTED OUT - Previous ApiResponse format for error handling
          /*
                    if (error instanceof ApiError) {
                        const response = new ApiResponse({
                            statusCode: error.statusCode,
                            data: null,
                            message: error.message,
                        });

                        return new Response(JSON.stringify(response.toJSON()), {
                            status: error.statusCode,
                            headers: { "Content-Type": "application/json" },
                        });
                    }

                    const response = new ApiResponse({
                        statusCode: 500,
                        data: null,
                        message: "Internal server error while processing PDF",
                    });

                    return new Response(JSON.stringify(response.toJSON()), {
                        status: 500,
                        headers: { "Content-Type": "application/json" },
                    });
                    */
        }
      },
      {
        component: "api_controller",
        endpoint: "/process-pdf",
      }
    );
  },
};
