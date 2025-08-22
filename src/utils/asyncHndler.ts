import { ApiError } from "./ApiError";
import { jsonResponse } from "./jsonResponse";

export function asyncHandler(
    handler: (req: Request) => Promise<Response> | Response
) {
    return async (req: Request) => {
        try {
            return await handler(req);
        } catch (err) {
            if (err instanceof ApiError) {
                return jsonResponse(
                    {
                        success: false,
                        message: err.message,
                        errors: err.errors,
                        data: err.data,
                    },
                    err.statusCode
                );
            }
            return jsonResponse(
                { success: false, message: "Internal Server Error" },
                500
            );
        }
    };
}